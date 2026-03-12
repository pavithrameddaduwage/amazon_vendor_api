import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { firstValueFrom } from 'rxjs';
import * as zlib from 'zlib';
import { Repository } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import { AmazonSalesAggregate } from './entities/amazon_sales_aggregate.entity';
import { AmazonSalesByAsin } from './entities/amazon_sales_by_asin.entity';
import { ReportStatusEntity } from '../common/entities/report-status.entity';

const REPORT_TYPE = 'GET_VENDOR_SALES_REPORT';
const MARKETPLACE_ID = 'ATVPDKIKX0DER';
const BASE_URL = 'https://sellingpartnerapi-na.amazon.com';

const POLL_INTERVAL_MS = 30_000;
const POLL_TIMEOUT_MS = 30 * 60 * 1000;
const CREATE_REPORT_THROTTLE_MS = 65_000;
const DOCUMENT_THROTTLE_MS = 120_000;
const MAX_RETRIES = 8;
const SLOW_ENDPOINT_BACKOFF_MS = 70_000;

@Injectable()
export class SalesService {
  private currentAccessToken: string | null = null;
  private tokenExpirationTime: number | null = null;
  private readonly logger = new Logger(SalesService.name);

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

  private async ensureAccessToken(): Promise<void> {
    if (!this.currentAccessToken || Date.now() >= (this.tokenExpirationTime ?? 0)) {
      const { access_token, expirationTime } = await this.authService.getAccessToken();
      this.currentAccessToken = access_token;
      this.tokenExpirationTime = expirationTime;
    }
  }

  private get authHeaders() {
    return {
      Authorization: `Bearer ${this.currentAccessToken}`,
      'x-amz-access-token': this.currentAccessToken,
      'Content-Type': 'application/json',
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async retryOn429<T>(fn: () => Promise<T>, label: string, minBackoff = 2_000): Promise<T> {
    let backoff = minBackoff;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        const status = err.response?.status;
        if (status === 429 && attempt < MAX_RETRIES) {
          const retryAfter = Number(err.response?.headers?.['retry-after'] ?? 0) * 1000;
          const wait = Math.max(retryAfter, backoff);
          this.logger.warn(`[${label}] 429 rate-limited. Waiting ${wait}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
          await this.delay(wait);
          backoff = Math.min(backoff * 2, 300_000);
        } else {
          throw err;
        }
      }
    }
    throw new Error(`[${label}] Exceeded max retries`);
  }

  private async createReport(dataStartTime: Date, dataEndTime: Date): Promise<string> {
    await this.ensureAccessToken();

    const body = {
      reportType: REPORT_TYPE,
      marketplaceIds: [MARKETPLACE_ID],
      dataStartTime: dataStartTime.toISOString(),
      dataEndTime: dataEndTime.toISOString(),
      reportOptions: {
        reportPeriod: 'DAY',
        distributorView: 'SOURCING',
        sellingProgram: 'RETAIL',
      },
    };

    const response = await this.retryOn429(
      () => firstValueFrom(this.httpService.post(`${BASE_URL}/reports/2021-06-30/reports`, body, { headers: this.authHeaders })),
      'createReport',
      SLOW_ENDPOINT_BACKOFF_MS,
    );

    const reportId: string = response.data.reportId;
    this.logger.log(`createReport -> reportId: ${reportId} | window: ${dataStartTime.toISOString()} to ${dataEndTime.toISOString()}`);
    return reportId;
  }

  private async pollUntilDone(reportId: string): Promise<{
    reportDocumentId: string;
    dataStartTime: Date;
    dataEndTime: Date;
    createdTime: Date;
  }> {
    await this.ensureAccessToken();
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const response = await this.retryOn429(
        () => firstValueFrom(this.httpService.get(`${BASE_URL}/reports/2021-06-30/reports/${reportId}`, { headers: this.authHeaders })),
        'getReport',
      );

      const { processingStatus, reportDocumentId, dataStartTime, dataEndTime, createdTime } = response.data;
      this.logger.log(`getReport [${reportId}] -> status: ${processingStatus}`);

      if (processingStatus === 'DONE') {
        if (!reportDocumentId) throw new Error(`Report ${reportId} DONE but no reportDocumentId`);
        return {
          reportDocumentId,
          dataStartTime: new Date(dataStartTime),
          dataEndTime: new Date(dataEndTime),
          createdTime: new Date(createdTime),
        };
      }

      if (processingStatus === 'FATAL' || processingStatus === 'CANCELLED') {
        throw new Error(`Report ${reportId} ended with status: ${processingStatus}`);
      }

      await this.delay(POLL_INTERVAL_MS);
    }

    throw new Error(`Report ${reportId} timed out after ${POLL_TIMEOUT_MS / 60000} minutes`);
  }

  private async downloadDocument(reportDocumentId: string): Promise<any> {
    await this.ensureAccessToken();

    const metaResponse = await this.retryOn429(
      () => firstValueFrom(this.httpService.get(`${BASE_URL}/reports/2021-06-30/documents/${reportDocumentId}`, { headers: this.authHeaders })),
      'getReportDocument',
      SLOW_ENDPOINT_BACKOFF_MS,
    );

    const { url: downloadUrl, compressionAlgorithm } = metaResponse.data;

    const dataResponse = await firstValueFrom(
      this.httpService.get(downloadUrl, { responseType: 'arraybuffer' }),
    );

    const raw = compressionAlgorithm === 'GZIP'
      ? zlib.gunzipSync(dataResponse.data)
      : dataResponse.data;

    return JSON.parse(raw.toString('utf-8'));
  }

  public async fetchAndStoreReports(startDate: Date, endDate: Date): Promise<void> {
    this.logger.log(`Sales fetch: ${startDate.toISOString()} to ${endDate.toISOString()}`);

    await this.reportStatusRepository.delete({ reportType: REPORT_TYPE });
    this.logger.log('Truncated stale sales report_status rows');

    const days = this.buildDailyWindows(startDate, endDate);
    this.logger.log(`Requesting ${days.length} daily report(s)`);

    for (let i = 0; i < days.length; i++) {
      const { dayStart, dayEnd } = days[i];

      try {
        if (i > 0) {
          this.logger.log(`Throttling ${CREATE_REPORT_THROTTLE_MS / 1000}s before next createReport...`);
          await this.delay(CREATE_REPORT_THROTTLE_MS);
        }

        const reportId = await this.createReport(dayStart, dayEnd);

        const existing = await this.reportStatusRepository.findOne({ where: { reportId } });
        if (!existing) {
          await this.reportStatusRepository.save(
            this.reportStatusRepository.create({
              reportId,
              reportType: REPORT_TYPE,
              dataStartTime: dayStart,
              dataEndTime: dayEnd,
              status: 'IN_PROGRESS',
              retryCount: 0,
            }),
          );
        }

        const { reportDocumentId, dataStartTime, dataEndTime, createdTime } = await this.pollUntilDone(reportId);

        await this.reportStatusRepository.update({ reportId }, {
          reportDocumentId,
          dataStartTime,
          dataEndTime,
          createdTime,
          status: 'DOWNLOADING',
        });

        this.logger.log(`Throttling ${DOCUMENT_THROTTLE_MS / 1000}s before document download...`);
        await this.delay(DOCUMENT_THROTTLE_MS);

        const data = await this.downloadDocument(reportDocumentId);
        await this.processSalesData(data);

        await this.reportStatusRepository.update({ reportId }, { status: 'COMPLETED', errorMessage: null });
        this.logger.log(`Completed report ${reportId} for ${dayStart.toISOString()}`);

      } catch (error: any) {
        this.logger.error(`Failed day ${dayStart.toISOString()}: ${error.message}`);
        await this.retryFailedReport(dayStart, dayEnd, error.message);
      }
    }

    await this.retryUntilAllComplete();
  }

  private buildDailyWindows(startDate: Date, endDate: Date): Array<{ dayStart: Date; dayEnd: Date }> {
    const windows: Array<{ dayStart: Date; dayEnd: Date }> = [];
    const current = new Date(startDate);
    current.setUTCHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setUTCHours(23, 59, 59, 999);

    while (current <= end) {
      const dayStart = new Date(current);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(current);
      dayEnd.setUTCHours(23, 59, 59, 999);
      windows.push({ dayStart, dayEnd });
      current.setUTCDate(current.getUTCDate() + 1);
    }
    return windows;
  }

  private async retryFailedReport(dayStart: Date, dayEnd: Date, lastError: string): Promise<void> {
    const existing = await this.reportStatusRepository.findOne({
      where: { dataStartTime: dayStart, dataEndTime: dayEnd, reportType: REPORT_TYPE },
    });
    if (existing) {
      await this.reportStatusRepository.update(existing.id, {
        status: 'FAILED',
        errorMessage: lastError,
        retryCount: (existing.retryCount ?? 0) + 1,
      });
    }
  }

  private async retryUntilAllComplete(): Promise<void> {
    let round = 1;

    while (true) {
      const failed = await this.reportStatusRepository.find({ where: { status: 'FAILED', reportType: REPORT_TYPE } });
      if (!failed.length) {
        this.logger.log('All sales reports completed successfully.');
        return;
      }

      this.logger.warn(`Retry round ${round}: ${failed.length} sales report(s) still FAILED. Waiting 5 minutes before retrying...`);
      await this.delay(5 * 60 * 1000);

      for (const record of failed) {
        try {
          await this.delay(CREATE_REPORT_THROTTLE_MS);

          const reportId = await this.createReport(record.dataStartTime, record.dataEndTime);
          await this.reportStatusRepository.update(record.id, { reportId, status: 'IN_PROGRESS', retryCount: (record.retryCount ?? 0) + 1 });

          const { reportDocumentId, dataStartTime, dataEndTime, createdTime } = await this.pollUntilDone(reportId);
          await this.reportStatusRepository.update(record.id, { reportDocumentId, dataStartTime, dataEndTime, createdTime, status: 'DOWNLOADING' });

          await this.delay(DOCUMENT_THROTTLE_MS);
          const data = await this.downloadDocument(reportDocumentId);
          await this.processSalesData(data);
          await this.reportStatusRepository.update(record.id, { status: 'COMPLETED', errorMessage: null });
          this.logger.log(`Retry round ${round}: succeeded for ${record.dataStartTime?.toISOString()}`);
        } catch (err: any) {
          this.logger.error(`Retry round ${round}: failed for ${record.dataStartTime?.toISOString()}: ${err.message}`);
          await this.reportStatusRepository.update(record.id, {
            status: 'FAILED',
            errorMessage: err.message,
            retryCount: (record.retryCount ?? 0) + 1,
          });
        }
      }

      round++;
    }
  }

  async processSalesData(data: any): Promise<void> {
    if (!data || typeof data !== 'object') {
      this.logger.warn('processSalesData: received empty or invalid data');
      return;
    }

    this.logger.log(`processSalesData: top-level keys = [${Object.keys(data).join(', ')}]`);

    const aggregates = data.salesAggregate ?? [];
    const asins = data.salesByAsin ?? [];

    this.logger.log(`processSalesData: ${aggregates.length} aggregate row(s), ${asins.length} ASIN row(s)`);

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
      this.logger.log(`Upserted ${mapped.length} sales aggregate row(s)`);
    } else {
      this.logger.warn('processSalesData: no salesAggregate rows found in document');
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
      this.logger.log(`Upserted ${mapped.length} sales-by-ASIN row(s)`);
    } else {
      this.logger.warn('processSalesData: no salesByAsin rows found in document');
    }
  }
}
