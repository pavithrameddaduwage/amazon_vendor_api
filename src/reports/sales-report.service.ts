import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { firstValueFrom } from 'rxjs';
import * as zlib from 'zlib';
import { AuthService } from 'src/auth.service';
import { AmazonSalesAggregate } from './entities/amazon_sales_aggregate.entity';
import { AmazonSalesByAsin } from './entities/amazon_sales_by_asin.entity';
import { ReportStatusEntity } from './entities/ReportStatusEntity';
import { In, Repository } from 'typeorm';

@Injectable()
export class SalesReportService {
  private currentAccessToken: string | null = null;
  private tokenExpirationTime: number | null = null;
  private readonly baseUrl = 'https://sellingpartnerapi-na.amazon.com';
  private readonly maxRetries = 5;
  private readonly retryDelay = 5000;
  private readonly logger = new Logger(SalesReportService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly authService: AuthService,
    @InjectRepository(AmazonSalesByAsin)
    private readonly salesByAsinRepository: Repository<AmazonSalesByAsin>,
    @InjectRepository(AmazonSalesAggregate)
    private readonly salesAggregateRepository: Repository<AmazonSalesAggregate>,
    @InjectRepository(ReportStatusEntity)
    private readonly reportStatusRepository: Repository<ReportStatusEntity>,
  ) {}

  private async ensureAccessToken() {
    const currentTime = new Date().getTime();
    if (!this.currentAccessToken || currentTime >= this.tokenExpirationTime!) {
      try {
        const { access_token, expirationTime } = await this.authService.getAccessToken();
        this.currentAccessToken = access_token;
        this.tokenExpirationTime = expirationTime;
      } catch (error) {
        this.logger.error('Error fetching access token', error.message || error);
        throw new Error('Unable to fetch access token.');
      }
    }
  }

  private dateFormat(date: Date): string {
    return date.toISOString();
  }

  private async fetchReports(reportType: string, startDate: Date, endDate: Date): Promise<any[]> {
    const reportPeriod = 'DAY';
    let baseFetchUrl =
      `${this.baseUrl}/reports/2021-06-30/reports?reportTypes=${reportType}` +
      `&processingStatuses=DONE&marketplaceIds=ATVPDKIKX0DER&pageSize=100` +
      `&createdSince=${this.dateFormat(startDate)}&createdUntil=${this.dateFormat(endDate)}` +
      `&reportPeriod=${reportPeriod}&distributorView=SOURCING&sellingProgram=RETAIL`;

    let allReports: any[] = [];
    const processedReportIds = new Set<string>();
    let requestQueue: string[] = [baseFetchUrl];

    await this.ensureAccessToken();

    while (requestQueue.length > 0) {
      const url = requestQueue.shift();
      if (!url) continue;

      let retryCount = 0;
      let backoffDelay = 1000;

      while (retryCount <= this.maxRetries) {
        try {
          this.logger.log(`Requesting report list: ${url}`);

          const response = await firstValueFrom(
            this.httpService.get(url, {
              headers: {
                Authorization: `Bearer ${this.currentAccessToken}`,
                'x-amz-access-token': this.currentAccessToken,
                Accept: 'application/json',
              },
            }),
          );

          const { reports, nextToken } = response.data;

          if (reports?.length) {
            for (const report of reports) {
              const reportDocumentId = report.reportDocumentId;
              if (reportDocumentId && !processedReportIds.has(reportDocumentId)) {
                allReports.push({ reportDocumentId });
                processedReportIds.add(reportDocumentId);
              }
            }
          }

          if (nextToken) {
            requestQueue.push(`${this.baseUrl}/reports/2021-06-30/reports?nextToken=${encodeURIComponent(nextToken)}`);
          }

          break;
        } catch (err: any) {
          const status = err.response?.status;
          const message = err.response?.data || err.message;

          this.logger.warn(`Error: ${status}, ${JSON.stringify(message)}`);

          if (status === 429 && retryCount < this.maxRetries) {
            retryCount++;
            this.logger.warn(`Rate limited. Retrying after ${backoffDelay}ms...`);
            await this.delay(backoffDelay);
            backoffDelay *= 2;
          } else {
            throw new Error(`Failed fetching reports: ${message}`);
          }
        }
      }
    }

    return allReports;
  }

  private async fetchReportDocument(reportDocumentId: string, retryCount = 0): Promise<any> {
    await this.ensureAccessToken();

    const url = `${this.baseUrl}/reports/2021-06-30/documents/${reportDocumentId}`;

    try {
      this.logger.log(`Fetching document for ID: ${reportDocumentId}`);

      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: {
            Authorization: `Bearer ${this.currentAccessToken}`,
            'x-amz-access-token': this.currentAccessToken,
            Accept: 'application/json',
          },
        }),
      );

      const { url: documentUrl, compressionAlgorithm = 'GZIP' } = response.data;

      const documentResponse = await firstValueFrom(
        this.httpService.get(documentUrl, { responseType: 'arraybuffer' }),
      );

      const data =
        compressionAlgorithm === 'GZIP'
          ? JSON.parse(zlib.gunzipSync(documentResponse.data).toString('utf-8'))
          : JSON.parse(documentResponse.data.toString('utf-8'));

      return data;
    } catch (error: any) {
      this.logger.error(`Error fetching document for ${reportDocumentId}: ${error.message}`);
      if (retryCount < this.maxRetries) {
        this.logger.warn(`Retrying document fetch (${retryCount + 1})`);
        await this.delay(this.retryDelay);
        return this.fetchReportDocument(reportDocumentId, retryCount + 1);
      }
      throw new Error(`Failed to fetch report document after retries.`);
    }
  }

  public async fetchAndStoreReports(startDate: Date, endDate: Date) {
    const reportTypes = [
      { type: 'GET_VENDOR_SALES_REPORT', process: this.processVendorSalesReportWithoutReport.bind(this) },
    ];

    for (const { type, process } of reportTypes) {
      const reports = await this.fetchReports(type, startDate, endDate);
      if (!reports.length) continue;

      const reportIds = reports.map(r => r.reportDocumentId).filter(Boolean);

      const existing = await this.reportStatusRepository.find({ where: { reportId: In(reportIds) } });
      const existingIds = new Set(existing.map(r => r.reportId));

      const newEntries = reports
        .filter(r => !existingIds.has(r.reportDocumentId))
        .map(r => ({
          reportType: type,
          reportId: r.reportDocumentId,
          startDate,
          endDate,
          status: 'IN_PROGRESS',
          retryCount: 0,
        }));

      if (newEntries.length) {
        await this.reportStatusRepository.upsert(newEntries, ['reportId']);
      }

      await this.processReportsSequentially();
    }
  }

  private async processReportsSequentially() {
    const pending = await this.reportStatusRepository.find({ where: { status: 'IN_PROGRESS' } });
    for (const report of pending) {
      await this.processReportUntilComplete(report);
    }

    const failed = await this.reportStatusRepository.find({ where: { status: 'FAILED' } });
    for (const report of failed) {
      await this.processReportUntilComplete(report);
    }
  }

  private async processReportUntilComplete(reportStatus: any) {
    const { reportId, retryCount = 0 } = reportStatus;
    let backoffDelay = 500;

    try {
      const reportDocument = await this.fetchReportDocument(reportId);
      if (!reportDocument) throw new Error('No data in report document.');

      const { salesAggregate, salesByAsin } = reportDocument;

      await this.processVendorSalesReportWithoutReport({ salesAggregate, salesByAsin });

      await this.reportStatusRepository.update(reportStatus.id, {
        status: 'COMPLETED',
        errorMessage: null,
      });
    } catch (error: any) {
      const attempts = retryCount + 1;
      await this.reportStatusRepository.update(reportStatus.id, {
        status: 'FAILED',
        errorMessage: error.message,
        retryCount: attempts,
      });

      this.logger.warn(`Retrying report ${reportId}, attempt ${attempts}. Error: ${error.message}`);
      await this.delay(backoffDelay);
    }
  }

  async processVendorSalesReportWithoutReport(data: any) {
    if (!data || typeof data !== 'object') return;

    const aggregates = (data.salesAggregate ?? []).filter((a: any) => a.startDate === a.endDate);
    const asins = (data.salesByAsin ?? []).filter((a: any) => a.startDate === a.endDate);

    if (aggregates.length > 0) {
      const mapped = aggregates.map(a => ({
        startDate: a.startDate,
        endDate: a.endDate,
        customerReturns: a.customerReturns ?? 0,
        orderedRevenueAmount: a.orderedRevenue?.amount ?? 0,
        orderedRevenueCurrency: a.orderedRevenue?.currencyCode ?? 'USD',
        orderedUnits: a.orderedUnits ?? 0,
        shippedCogsAmount: a.shippedCogs?.amount ?? 0,
        shippedCogsCurrency: a.shippedCogs?.currencyCode ?? 'USD',
        shippedRevenueAmount: a.shippedRevenue?.amount ?? 0,
        shippedRevenueCurrency: a.shippedRevenue?.currencyCode ?? 'USD',
        shippedUnits: a.shippedUnits ?? 0,
      }));
      await this.salesAggregateRepository.upsert(mapped, ['startDate', 'endDate']);
    }

    if (asins.length > 0) {
      const mapped = asins.map(a => ({
        asin: a.asin,
        startDate: a.startDate,
        endDate: a.endDate,
        customerReturns: a.customerReturns ?? 0,
        orderedRevenueAmount: a.orderedRevenue?.amount ?? 0,
        orderedRevenueCurrency: a.orderedRevenue?.currencyCode ?? 'USD',
        orderedUnits: a.orderedUnits ?? 0,
        shippedCogsAmount: a.shippedCogs?.amount ?? 0,
        shippedCogsCurrency: a.shippedCogs?.currencyCode ?? 'USD',
        shippedRevenueAmount: a.shippedRevenue?.amount ?? 0,
        shippedRevenueCurrency: a.shippedRevenue?.currencyCode ?? 'USD',
        shippedUnits: a.shippedUnits ?? 0,
      }));
      await this.salesByAsinRepository.upsert(mapped, ['asin', 'startDate', 'endDate']);
    }
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
