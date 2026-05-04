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
import { LimiterService } from '../common/limiter.service';

const REPORT_TYPE = 'GET_VENDOR_SALES_REPORT';
const MARKETPLACE_ID = 'ATVPDKIKX0DER';
const BASE_URL = 'https://sellingpartnerapi-na.amazon.com';

const POLL_INTERVAL_INITIAL_MS = 30_000;  // Start polling slower (reports take time)
const POLL_INTERVAL_MAX_MS    = 60_000;  // Cap poll backoff at 60s
const POLL_TIMEOUT_MS = 30 * 60 * 1000;  // 30 min timeout
const DOCUMENT_WAIT_MS = 20_000;         // Wait longer before fetching document
const MAX_RETRIES = 10;
const SLOW_ENDPOINT_BACKOFF_MS = 60_000; // Respect Amazon's 1-per-minute limits
const DOCUMENT_ENDPOINT_BACKOFF_MS = 90_000;

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
    private readonly limiterService: LimiterService,
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

  private async retryOn429<T>(fn: () => Promise<T>, label: string, minBackoff = 5_000): Promise<T> {
    let backoff = minBackoff;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        const status = err.response?.status;
        if (status !== 429 || attempt === MAX_RETRIES - 1) {
          throw err;
        }
        const retryAfterMs = Number(err.response?.headers?.['retry-after'] ?? 0) * 1000;
        const jitter = Math.floor(Math.random() * 3_000);
        const wait = Math.max(retryAfterMs, backoff) + jitter;
        this.logger.warn(`[${label}] 429 rate-limited. Waiting ${wait}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await this.delay(wait);
        backoff = Math.min(backoff * 2, 120_000);
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

    const response = await this.limiterService.createReportLimiter.schedule(() => 
      this.retryOn429(
        () => firstValueFrom(this.httpService.post(`${BASE_URL}/reports/2021-06-30/reports`, body, { headers: this.authHeaders })),
        'createReport',
        SLOW_ENDPOINT_BACKOFF_MS,
      )
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
    let pollInterval = POLL_INTERVAL_INITIAL_MS;

    while (Date.now() < deadline) {
      const response = await this.retryOn429(
        () => firstValueFrom(this.httpService.get(`${BASE_URL}/reports/2021-06-30/reports/${reportId}`, { headers: this.authHeaders })),
        'getReport',
      );

      const { processingStatus, reportDocumentId, dataStartTime, dataEndTime, createdTime } = response.data;
      this.logger.log(`getReport [${reportId}] -> status: ${processingStatus} (next poll in ${pollInterval}ms)`);

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

      await this.delay(pollInterval);
      // Adaptive backoff: double interval each round up to the cap
      pollInterval = Math.min(pollInterval * 2, POLL_INTERVAL_MAX_MS);
    }

    throw new Error(`Report ${reportId} timed out after ${POLL_TIMEOUT_MS / 60000} minutes`);
  }

  private async downloadDocument(reportDocumentId: string): Promise<any> {
    await this.ensureAccessToken();

    // Brief buffer after DONE before fetching document metadata
    this.logger.log(`Waiting ${DOCUMENT_WAIT_MS / 1000}s before fetching document metadata: ${reportDocumentId}`);
    await this.delay(DOCUMENT_WAIT_MS);

    const metaResponse = await this.limiterService.documentLimiter.schedule(() =>
      this.retryOn429(
        () =>
          firstValueFrom(
            this.httpService.get(
              `${BASE_URL}/reports/2021-06-30/documents/${reportDocumentId}`,
              {
                headers: this.authHeaders,
                params: { enableContentEncodingUrlHeader: true },
              },
            ),
          ),
        'getReportDocument',
        DOCUMENT_ENDPOINT_BACKOFF_MS,
      )
    );

    const { url: downloadUrl, compressionAlgorithm } = metaResponse.data;

    this.logger.log(`Fetching report file: ${reportDocumentId}`);
    const dataResponse = await firstValueFrom(
      this.httpService.get(downloadUrl, { responseType: 'arraybuffer' }),
    );

    const raw = compressionAlgorithm === 'GZIP'
      ? zlib.gunzipSync(dataResponse.data)
      : dataResponse.data;
    this.logger.log(`Unzip complete: ${reportDocumentId}`);

    return JSON.parse(raw.toString('utf-8'));
  }

  public async fetchAndStoreReports(startDate: Date, endDate: Date): Promise<void> {
    this.logger.log(`Sales fetch: ${startDate.toISOString()} to ${endDate.toISOString()}`);

    let record = await this.reportStatusRepository.findOne({
      where: { reportType: REPORT_TYPE, dataStartTime: startDate, dataEndTime: endDate },
    });

    if (record?.status === 'COMPLETED') {
      this.logger.log(`Sales report for ${startDate.toISOString()} already COMPLETED. Skipping.`);
      return;
    }

    // Create record if it doesn't exist
    if (!record) {
      record = await this.reportStatusRepository.save(
        this.reportStatusRepository.create({
          reportType: REPORT_TYPE,
          dataStartTime: startDate,
          dataEndTime: endDate,
          status: 'PENDING',
          retryCount: 0,
        }),
      );
    }

    let reportId: string | null = record.reportId || null;

    try {
      if (!reportId || record.status === 'FAILED') {
        reportId = await this.createReport(startDate, endDate);
        await this.reportStatusRepository.update(record.id, {
          reportId,
          status: 'IN_PROGRESS',
          retryCount: record.retryCount + 1,
          errorMessage: null,
        });
      }

      const pollResult = await this.pollUntilDone(reportId);

      await this.reportStatusRepository.update(record.id, {
        reportDocumentId: pollResult.reportDocumentId,
        status: 'DOWNLOADING',
      });

      const data = await this.downloadDocument(pollResult.reportDocumentId);
      await this.processSalesData(data);

      await this.reportStatusRepository.update(record.id, {
        status: 'COMPLETED',
        errorMessage: null,
      });

      this.logger.log(`Successfully completed weekly report ${reportId}`);
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Sales report attempt failed: ${message}`);

      await this.reportStatusRepository.update(record.id, {
        status: 'FAILED',
        errorMessage: message,
      });
    }
  }

  public async retryUntilAllComplete(): Promise<void> {
    const MAX_RETRY_ROUNDS = 3;

    for (let round = 1; round <= MAX_RETRY_ROUNDS; round++) {
      const failed = await this.reportStatusRepository.find({
        where: { status: 'FAILED', reportType: REPORT_TYPE },
      });

      if (!failed.length) {
        this.logger.log('All sales reports completed successfully.');
        return;
      }

      this.logger.warn(`Retry round ${round}: ${failed.length} failed report(s). Waiting 60s before retrying...`);
      await this.delay(60_000);

      const BATCH_SIZE = 2;
      for (let i = 0; i < failed.length; i += BATCH_SIZE) {
        const chunk = failed.slice(i, i + BATCH_SIZE);
        this.logger.log(`Retrying batch of ${chunk.length} failed reports...`);

        await Promise.allSettled(
          chunk.map(async (record) => {
            try {
              // Small jitter
              await this.delay(Math.random() * 5000);
              
              const reportId = await this.createReport(record.dataStartTime, record.dataEndTime);

              await this.reportStatusRepository.update(record.id, {
                reportId,
                status: 'IN_PROGRESS',
                retryCount: (record.retryCount ?? 0) + 1,
              });

              const pollResult = await this.pollUntilDone(reportId);

              await this.reportStatusRepository.update(record.id, {
                reportDocumentId: pollResult.reportDocumentId,
                status: 'DOWNLOADING',
              });

              const data = await this.downloadDocument(pollResult.reportDocumentId);
              await this.processSalesData(data);

              await this.reportStatusRepository.update(record.id, {
                status: 'COMPLETED',
                errorMessage: null,
              });
            } catch (err: any) {
              await this.reportStatusRepository.update(record.id, {
                status: 'FAILED',
                errorMessage: err.message,
                retryCount: (record.retryCount ?? 0) + 1,
              });
            }
          }),
        );
        if (i + BATCH_SIZE < failed.length) {
          await this.delay(10_000); // delay between retry batches
        }
      }
    }

    this.logger.warn('Some reports still failed after max retry rounds.');
  }

  async processSalesData(data: any): Promise<void> {
    if (!data || typeof data !== 'object') {
      this.logger.warn('processSalesData: received empty or invalid data');
      return;
    }

    const aggregates = data.salesAggregate ?? [];
    const asins = data.salesByAsin ?? [];

    this.logger.log(`processSalesData: ${aggregates.length} aggregate row(s), ${asins.length} ASIN row(s)`);

    const batchSize = 200;

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

      for (let i = 0; i < mapped.length; i += batchSize) {
        await this.salesAggregateRepository.upsert(mapped.slice(i, i + batchSize), ['startDate', 'endDate']);
      }
      this.logger.log(`Inserted sales aggregate rows: ${mapped.length}`);
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

      for (let i = 0; i < mapped.length; i += batchSize) {
        await this.salesByAsinRepository.upsert(mapped.slice(i, i + batchSize), ['asin', 'startDate', 'endDate']);
      }
      this.logger.log(`Inserted sales-by-ASIN rows: ${mapped.length}`);
    }
  }
}
