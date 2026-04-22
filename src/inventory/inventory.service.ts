import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { firstValueFrom } from 'rxjs';
import * as zlib from 'zlib';
import { Repository } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import { AmazonInventoryByAsin } from './entities/amazon_inventory_by_asin.entity';
import { ReportStatusEntity } from '../common/entities/report-status.entity';

const REPORT_TYPE = 'GET_VENDOR_INVENTORY_REPORT';
const MARKETPLACE_ID = 'ATVPDKIKX0DER';
const BASE_URL = 'https://sellingpartnerapi-na.amazon.com';

const POLL_INTERVAL_INITIAL_MS = 5_000;   // start polling quickly
const POLL_INTERVAL_MAX_MS    = 30_000;  // cap poll backoff at 30s
const POLL_TIMEOUT_MS = 15 * 60 * 1000;
const DOCUMENT_WAIT_MS = 5_000;          // reduced from 15s — most docs ready quickly
const MAX_RETRIES = 6;
const SLOW_ENDPOINT_BACKOFF_MS = 15_000;

@Injectable()
export class InventoryService {
  private currentAccessToken: string | null = null;
  private tokenExpirationTime: number | null = null;
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly authService: AuthService,
    @InjectRepository(ReportStatusEntity)
    private readonly reportStatusRepository: Repository<ReportStatusEntity>,
    @InjectRepository(AmazonInventoryByAsin)
    private readonly inventoryByAsinRepository: Repository<AmazonInventoryByAsin>,
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

    const response = await this.retryOn429(
      () => firstValueFrom(
        this.httpService.post(`${BASE_URL}/reports/2021-06-30/reports`, body, { headers: this.authHeaders }),
      ),
      'createReport',
      SLOW_ENDPOINT_BACKOFF_MS,
    );

    const reportId: string = response.data.reportId;
    this.logger.log(`createReport -> reportId: ${reportId} | ${dataStartTime.toISOString()} to ${dataEndTime.toISOString()}`);
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
        () => firstValueFrom(
          this.httpService.get(`${BASE_URL}/reports/2021-06-30/reports/${reportId}`, { headers: this.authHeaders }),
        ),
        'getReport',
      );

      const { processingStatus, reportDocumentId, dataStartTime, dataEndTime, createdTime } = response.data;
      this.logger.log(`getReport [${reportId}] -> ${processingStatus} (next poll in ${pollInterval}ms)`);

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

    const metaResponse = await this.retryOn429(
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
      SLOW_ENDPOINT_BACKOFF_MS,
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
    this.logger.log(`Inventory fetch: ${startDate.toISOString()} to ${endDate.toISOString()}`);

    const existing = await this.reportStatusRepository.findOne({
      where: { reportType: REPORT_TYPE, dataStartTime: startDate, dataEndTime: endDate },
    });

    if (existing?.status === 'COMPLETED' || existing?.status === 'COMPLETED_EMPTY') {
      this.logger.log(`Inventory report for ${startDate.toISOString()} already done. Skipping new fetch.`);
      return;
    }

    let reportId: string | null = existing?.reportId || null;

    try {
      if (!reportId || existing?.status === 'FAILED') {
        reportId = await this.createReport(startDate, endDate);

        if (existing) {
          await this.reportStatusRepository.update(existing.id, {
            reportId,
            status: 'IN_PROGRESS',
            retryCount: (existing.retryCount ?? 0) + 1,
            errorMessage: null,
          });
        } else {
          await this.reportStatusRepository.save(
            this.reportStatusRepository.create({
              reportId,
              reportType: REPORT_TYPE,
              dataStartTime: startDate,
              dataEndTime: endDate,
              status: 'IN_PROGRESS',
              retryCount: 0,
            }),
          );
        }
      }

      const pollResult = await this.pollUntilDone(reportId);

      await this.reportStatusRepository.update(
        { reportId },
        {
          reportDocumentId: pollResult.reportDocumentId,
          dataStartTime: pollResult.dataStartTime,
          dataEndTime: pollResult.dataEndTime,
          createdTime: pollResult.createdTime,
          status: 'DOWNLOADING',
        },
      );

      const data = await this.downloadDocument(pollResult.reportDocumentId);
      const inventoryData = data.inventoryByAsin ?? (Array.isArray(data) ? data : null);

      if (!inventoryData || inventoryData.length === 0) {
        this.logger.warn(`No inventory data for report ${reportId} — skipping`);
        await this.reportStatusRepository.update({ reportId }, { status: 'COMPLETED_EMPTY' });
      } else {
        await this.processInventoryData(inventoryData);
        await this.reportStatusRepository.update(
          { reportId },
          { status: 'COMPLETED', errorMessage: null },
        );
        this.logger.log(`Successfully completed inventory weekly report ${reportId}`);
      }
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Inventory report attempt failed (ReportID: ${reportId}): ${message}`);

      if (reportId) {
        await this.reportStatusRepository.update(
          { reportId },
          { status: 'FAILED', errorMessage: message },
        );
      } else {
        // Check if we already have a record for this range
        const currentRecord = await this.reportStatusRepository.findOne({
          where: { reportType: REPORT_TYPE, dataStartTime: startDate, dataEndTime: endDate },
        });

        if (!currentRecord) {
          await this.reportStatusRepository.save(
            this.reportStatusRepository.create({
              reportType: REPORT_TYPE,
              dataStartTime: startDate,
              dataEndTime: endDate,
              retryCount: 0,
              status: 'FAILED',
              errorMessage: message,
            }),
          );
        } else {
          await this.reportStatusRepository.update(currentRecord.id, {
            status: 'FAILED',
            errorMessage: message,
          });
        }
      }
    }

  }

  public async retryUntilAllComplete(): Promise<void> {
    const MAX_RETRY_ROUNDS = 3;

    for (let round = 1; round <= MAX_RETRY_ROUNDS; round++) {
      const failed = await this.reportStatusRepository.find({
        where: { status: 'FAILED', reportType: REPORT_TYPE },
      });

      if (!failed.length) {
        this.logger.log('All inventory reports completed successfully.');
        return;
      }

      this.logger.warn(`Retry round ${round}: ${failed.length} failed report(s). Waiting 60s before retrying...`);
      await this.delay(60_000);

      // Process all failed reports in parallel for this round
      await Promise.allSettled(
        failed.map(async (record) => {
          try {
            const reportId = await this.createReport(record.dataStartTime, record.dataEndTime);

            await this.reportStatusRepository.update(record.id, {
              reportId,
              status: 'IN_PROGRESS',
              retryCount: (record.retryCount ?? 0) + 1,
            });

            const pollResult = await this.pollUntilDone(reportId);

            await this.reportStatusRepository.update(record.id, {
              reportDocumentId: pollResult.reportDocumentId,
              dataStartTime: pollResult.dataStartTime,
              dataEndTime: pollResult.dataEndTime,
              createdTime: pollResult.createdTime,
              status: 'DOWNLOADING',
            });

            const data = await this.downloadDocument(pollResult.reportDocumentId);
            const inventoryData = data.inventoryByAsin ?? (Array.isArray(data) ? data : null);

            if (inventoryData?.length) {
              await this.processInventoryData(inventoryData);
            }

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
    }

    this.logger.warn('Some inventory reports still failed after max retry rounds.');
  }

  async processInventoryData(inventoryByAsinData: any[]): Promise<void> {
    const records = inventoryByAsinData
      .filter(d => d.asin && d.startDate === d.endDate && !isNaN(new Date(d.startDate).getTime()))
      .map(d => ({
        startDate: new Date(d.startDate),
        endDate: new Date(d.endDate),
        asin: d.asin,
        sourceableProductOutOfStockRate: d.sourceableProductOutOfStockRate ?? 0,
        procurableProductOutOfStockRate: d.procurableProductOutOfStockRate ?? 0,
        openPurchaseOrderUnits: d.openPurchaseOrderUnits ?? 0,
        receiveFillRate: d.receiveFillRate ?? 0,
        averageVendorLeadTimeDays: d.averageVendorLeadTimeDays ?? 0,
        sellThroughRate: d.sellThroughRate ?? 0,
        unfilledCustomerOrderedUnits: d.unfilledCustomerOrderedUnits ?? 0,
        vendorConfirmationRate: d.vendorConfirmationRate ?? 0,
        netReceivedInventoryCostAmount: d.netReceivedInventoryCost?.amount ?? 0,
        netReceivedInventoryCostCurrencyCode: d.netReceivedInventoryCost?.currencyCode ?? 'USD',
        netReceivedInventoryUnits: d.netReceivedInventoryUnits ?? 0,
        sellableOnHandInventoryCostAmount: d.sellableOnHandInventoryCost?.amount ?? 0,
        sellableOnHandInventoryCostCurrencyCode: d.sellableOnHandInventoryCost?.currencyCode ?? 'USD',
        sellableOnHandInventoryUnits: d.sellableOnHandInventoryUnits ?? 0,
        unsellableOnHandInventoryCostAmount: d.unsellableOnHandInventoryCost?.amount ?? 0,
        unsellableOnHandInventoryCostCurrencyCode: d.unsellableOnHandInventoryCost?.currencyCode ?? 'USD',
        unsellableOnHandInventoryUnits: d.unsellableOnHandInventoryUnits ?? 0,
        aged90PlusDaysSellableInventoryCostAmount: d.aged90PlusDaysSellableInventoryCost?.amount ?? 0,
        aged90PlusDaysSellableInventoryCostCurrencyCode: d.aged90PlusDaysSellableInventoryCost?.currencyCode ?? 'USD',
        aged90PlusDaysSellableInventoryUnits: d.aged90PlusDaysSellableInventoryUnits ?? 0,
      }));

    if (!records.length) {
      this.logger.log('No valid inventory records to save after filtering.');
      return;
    }

    const batchSize = 200;
    for (let i = 0; i < records.length; i += batchSize) {
      await this.inventoryByAsinRepository.upsert(records.slice(i, i + batchSize), ['asin', 'startDate', 'endDate']);
    }
    this.logger.log(`Inserted to database: ${records.length} inventory record(s)`);
  }
}
