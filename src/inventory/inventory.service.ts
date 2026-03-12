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

const POLL_INTERVAL_MS = 30_000;
const POLL_TIMEOUT_MS = 30 * 60 * 1000;
const CREATE_REPORT_THROTTLE_MS = 65_000;
const DOCUMENT_THROTTLE_MS = 65_000;
const MAX_RETRIES = 8;

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

  private async retryOn429<T>(fn: () => Promise<T>, label: string): Promise<T> {
    let backoff = 2_000;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        const status = err.response?.status;
        if (status === 429 && attempt < MAX_RETRIES) {
          const retryAfter = Number(err.response?.headers?.['retry-after'] ?? 0) * 1000;
          const wait = Math.max(retryAfter, backoff);
          this.logger.warn(`[${label}] 429 — waiting ${wait}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
          await this.delay(wait);
          backoff = Math.min(backoff * 2, 120_000);
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
      () => firstValueFrom(
        this.httpService.post(`${BASE_URL}/reports/2021-06-30/reports`, body, { headers: this.authHeaders }),
      ),
      'createReport',
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

    while (Date.now() < deadline) {
      const response = await this.retryOn429(
        () => firstValueFrom(
          this.httpService.get(`${BASE_URL}/reports/2021-06-30/reports/${reportId}`, { headers: this.authHeaders }),
        ),
        'getReport',
      );

      const { processingStatus, reportDocumentId, dataStartTime, dataEndTime, createdTime } = response.data;
      this.logger.log(`getReport [${reportId}] -> ${processingStatus}`);

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
      () => firstValueFrom(
        this.httpService.get(
          `${BASE_URL}/reports/2021-06-30/documents/${reportDocumentId}`,
          { headers: this.authHeaders },
        ),
      ),
      'getReportDocument',
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
    this.logger.log(`Inventory fetch: ${startDate.toISOString()} to ${endDate.toISOString()}`);

    await this.reportStatusRepository.delete({ reportType: REPORT_TYPE });
    this.logger.log('Truncated stale inventory report_status rows');

    const days = this.buildDailyWindows(startDate, endDate);
    this.logger.log(`Requesting ${days.length} daily inventory report(s)`);

    for (let i = 0; i < days.length; i++) {
      const { dayStart, dayEnd } = days[i];

      try {
        if (i > 0) {
          this.logger.log(`Throttling ${CREATE_REPORT_THROTTLE_MS / 1000}s before next createReport...`);
          await this.delay(CREATE_REPORT_THROTTLE_MS);
        }

        const reportId = await this.createReport(dayStart, dayEnd);

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
        const inventoryData = data.inventoryByAsin ?? (Array.isArray(data) ? data : null);

        if (!inventoryData || inventoryData.length === 0) {
          this.logger.warn(`No inventory data in document for ${dayStart.toISOString()} — skipping`);
          await this.reportStatusRepository.update({ reportId }, { status: 'COMPLETED_EMPTY' });
          continue;
        }

        await this.processInventoryData(inventoryData);
        await this.reportStatusRepository.update({ reportId }, { status: 'COMPLETED', errorMessage: null });
        this.logger.log(`Completed inventory report ${reportId} for ${dayStart.toISOString()}`);

      } catch (error: any) {
        this.logger.error(`Failed inventory day ${dayStart.toISOString()}: ${error.message}`);
        const existing = await this.reportStatusRepository.findOne({
          where: { dataStartTime: dayStart, reportType: REPORT_TYPE },
        });
        if (existing) {
          await this.reportStatusRepository.update(existing.id, {
            status: 'FAILED',
            errorMessage: error.message,
            retryCount: (existing.retryCount ?? 0) + 1,
          });
        }
      }
    }

    await this.retryAllFailed();
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

  private async retryAllFailed(): Promise<void> {
    const failed = await this.reportStatusRepository.find({
      where: { status: 'FAILED', reportType: REPORT_TYPE },
    });
    if (!failed.length) return;

    this.logger.warn(`Retrying ${failed.length} failed inventory reports...`);

    for (const record of failed) {
      if ((record.retryCount ?? 0) >= MAX_RETRIES) {
        this.logger.error(
          `Inventory report for ${record.dataStartTime?.toISOString()} exceeded max retries. Manual intervention required!`,
        );
        await this.reportStatusRepository.update(record.id, { status: 'PERMANENTLY_FAILED' });
        continue;
      }

      try {
        const backoff = Math.min(2_000 * Math.pow(2, record.retryCount ?? 0), 120_000);
        await this.delay(backoff + CREATE_REPORT_THROTTLE_MS);

        const reportId = await this.createReport(record.dataStartTime, record.dataEndTime);
        await this.reportStatusRepository.update(record.id, {
          reportId,
          status: 'IN_PROGRESS',
          retryCount: (record.retryCount ?? 0) + 1,
        });

        const { reportDocumentId, dataStartTime, dataEndTime, createdTime } = await this.pollUntilDone(reportId);
        await this.reportStatusRepository.update(record.id, {
          reportDocumentId, dataStartTime, dataEndTime, createdTime, status: 'DOWNLOADING',
        });

        await this.delay(DOCUMENT_THROTTLE_MS);
        const data = await this.downloadDocument(reportDocumentId);
        const inventoryData = data.inventoryByAsin ?? (Array.isArray(data) ? data : null);

        if (inventoryData?.length) {
          await this.processInventoryData(inventoryData);
        }

        await this.reportStatusRepository.update(record.id, { status: 'COMPLETED', errorMessage: null });
        this.logger.log(`Retry succeeded for inventory ${record.dataStartTime?.toISOString()}`);
      } catch (err: any) {
        this.logger.error(`Retry failed for inventory ${record.dataStartTime?.toISOString()}: ${err.message}`);
        await this.reportStatusRepository.update(record.id, {
          status: 'FAILED',
          errorMessage: err.message,
          retryCount: (record.retryCount ?? 0) + 1,
        });
      }
    }
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
    this.logger.log(`Saved ${records.length} inventory records.`);
  }
}
