import { Injectable, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { InjectRepository } from "@nestjs/typeorm";
import { firstValueFrom } from "rxjs";
import * as zlib from "zlib";
import { Repository } from "typeorm";
import { AuthService } from "src/auth.service";

import { AmazonInventoryByAsin } from "./entities/amazon_inventory_by_asin.entity";
import { AmazonInventoryReport } from "./entities/amazon_inventory_report.entity";
import { AmazonVendorInventory } from "./entities/amazon_vendor_inventory.entity";
import { ReportStatusEntity } from "./entities/ReportStatusEntity";

export class DuplicateReportError extends Error {
  constructor(message: string = "Duplicate report detected") {
    super(message);
    this.name = "DuplicateReportError";
  }
}

@Injectable()
export class InventoryReportService {
  private currentAccessToken: string | null = null;
  private tokenExpirationTime: number | null = null;
  private readonly baseUrl = 'https://sellingpartnerapi-na.amazon.com';
  private readonly maxRetries = 5;
  private readonly retryDelay = 5000;
  private readonly logger = new Logger(InventoryReportService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly authService: AuthService,
    @InjectRepository(ReportStatusEntity)
    private readonly reportStatusRepository: Repository<ReportStatusEntity>,
    @InjectRepository(AmazonInventoryReport)
    @InjectRepository(AmazonInventoryByAsin)
    private readonly amazonInventoryByAsinRepository: Repository<AmazonInventoryByAsin>,
  ) {}

  private async ensureAccessToken(): Promise<void> {
    if (!this.currentAccessToken || Date.now() >= (this.tokenExpirationTime ?? 0)) {
      try {
        const { access_token, expirationTime } = await this.authService.getAccessToken();
        if (!access_token) throw new Error('Access token is missing.');
        this.currentAccessToken = access_token;
        this.tokenExpirationTime = expirationTime;
      } catch (error) {
        this.logger.error('Error fetching access token:', error.message || error);
        throw new Error('Unable to fetch access token.');
      }
    }
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private dateFormat(date: Date): string {
    return date.toISOString();
  }

  private async createReport(reportType: string, startDate: Date, endDate: Date): Promise<string> {
    await this.ensureAccessToken();

    const url = `${this.baseUrl}/reports/2021-06-30/reports`;

    const body = {
      reportType,
      marketplaceIds: ["ATVPDKIKX0DER"],
      reportOptions: {
        reportPeriod: "DAY",
        distributorView: "SOURCING",
        sellingProgram: "RETAIL",
      },
      dataStartTime: this.dateFormat(startDate),
      dataEndTime: this.dateFormat(endDate),
    };

    try {
      const response = await firstValueFrom(this.httpService.post(url, body, {
        headers: {
          Authorization: `Bearer ${this.currentAccessToken}`,
          'x-amz-access-token': this.currentAccessToken,
          'Content-Type': 'application/json',
        },
      }));
      this.logger.log(`Report creation requested: ${response.data.reportId}`);
      return response.data.reportId;
    } catch (error) {
      this.logger.error('Error creating report:', error.message || error);
      throw new Error('Failed to create report.');
    }
  }

  private async fetchReports(reportType: string, startDate: Date, endDate: Date): Promise<any[]> {
    const initialUrl = `${this.baseUrl}/reports/2021-06-30/reports?reportTypes=${reportType}` +
      `&processingStatuses=DONE&marketplaceIds=ATVPDKIKX0DER&pageSize=100` +
      `&createdSince=${this.dateFormat(startDate)}&createdUntil=${this.dateFormat(endDate)}`;

    let allReports: any[] = [];
    const processedReportIds = new Set<string>();
    const failedRequests: string[] = [];
    let requestQueue: string[] = [initialUrl];

    await this.ensureAccessToken();

    while (requestQueue.length > 0) {
      const url = requestQueue.shift();
      if (!url) continue;

      let retryCount = 0;
      let backoffDelay = 1000;

      while (retryCount <= this.maxRetries) {
        try {
          this.logger.log(`Fetching reports from: ${url}`);
          const response = await firstValueFrom(this.httpService.get(url, {
            headers: {
              Authorization: `Bearer ${this.currentAccessToken}`,
              'x-amz-access-token': this.currentAccessToken,
            },
          }));

          const { reports, nextToken } = response.data;
          if (reports) {
            for (const report of reports) {
              const reportDocumentId = report.reportDocumentId || report.reportId;
              if (reportDocumentId && !processedReportIds.has(reportDocumentId)) {
                allReports.push(report);
                processedReportIds.add(reportDocumentId);
              }
            }
          }

          if (nextToken) {
            requestQueue.push(`${this.baseUrl}/reports/2021-06-30/reports?nextToken=${encodeURIComponent(nextToken)}`);
          }
          break;

        } catch (err) {
          if (err.response?.status === 429) {
            retryCount++;
            if (retryCount > this.maxRetries) {
              this.logger.warn(`Max retries reached for URL: ${url}.`);
              failedRequests.push(url);
              break;
            }
            this.logger.warn(`Rate limit hit, retrying in ${backoffDelay}ms...`);
            await this.delay(backoffDelay);
            backoffDelay = Math.min(backoffDelay * 2, 32000);
          } else {
            this.logger.error(`Error fetching reports: ${err.message || err}`);
            failedRequests.push(url);
            break;
          }
        }
      }
    }

    if (failedRequests.length > 0) {
      this.logger.warn(`Failed requests to retry later: ${failedRequests.length}`);
    }

    return allReports;
  }

  private async fetchReportDocument(reportDocumentId: string, retryCount = 0): Promise<any> {
    const url = `${this.baseUrl}/reports/2021-06-30/documents/${reportDocumentId}`;
    await this.ensureAccessToken();

    try {
      const response = await firstValueFrom(this.httpService.get(url, {
        headers: {
          Authorization: `Bearer ${this.currentAccessToken}`,
          'x-amz-access-token': this.currentAccessToken,
        },
      }));

      const { url: documentUrl, compressionAlgorithm = 'GZIP' } = response.data;
      const documentResponse = await firstValueFrom(this.httpService.get(documentUrl, { responseType: 'arraybuffer' }));
      const rawData = compressionAlgorithm === 'GZIP'
        ? zlib.gunzipSync(documentResponse.data)
        : documentResponse.data;
      const parsedData = JSON.parse(rawData.toString('utf-8'));

      if (!parsedData || (Array.isArray(parsedData) && parsedData.length === 0)) {
        throw new DuplicateReportError('Duplicate or empty report.');
      }

      return parsedData;

    } catch (error) {
      if (retryCount < this.maxRetries) {
        await this.delay(this.retryDelay);
        return this.fetchReportDocument(reportDocumentId, retryCount + 1);
      }
      throw error instanceof Error ? error : new Error('Unable to fetch report document.');
    }
  }

  public async fetchAndStoreReports(reportType: string, startDate: Date, endDate: Date): Promise<void> {
    const reportTypes = [
      { type: "GET_VENDOR_INVENTORY_REPORT", process: this.insertAsinInventoryData.bind(this) },
    ];

    await Promise.all(reportTypes.map(async ({ type }) => {
      try {
        
        await this.createReport(type, startDate, endDate);

     
        const reports = await this.fetchReports(type, startDate, endDate);
        if (!reports.length) return;

        const reportIds = reports.map(r => r.reportDocumentId || r.reportId).filter(Boolean);

        const existingReportIds = new Set((await this.reportStatusRepository.createQueryBuilder("report")
          .select("report.reportId")
          .where("report.reportId IN (:...ids)", { ids: reportIds })
          .getRawMany()).map(r => r.report_reportId));

        const newReports = reports.filter(r => !existingReportIds.has(r.reportDocumentId || r.reportId));
        if (newReports.length) {
          const chunkSize = 100;
          const insertData = newReports.map(report => this.reportStatusRepository.create({
            reportType: type,
            reportId: report.reportDocumentId || report.reportId,
            startDate,
            endDate,
            status: "IN_PROGRESS",
            retryCount: 0,
          }));

          for (let i = 0; i < insertData.length; i += chunkSize) {
            await this.reportStatusRepository.insert(insertData.slice(i, i + chunkSize));
          }
        }

        while (true) {
          const pendingReports = await this.reportStatusRepository.find({
            where: [{ status: "IN_PROGRESS" }, { status: "FAILED" }],
          });

          if (pendingReports.length === 0) {
            this.logger.log("All reports processed successfully.");
            break;
          }

          this.logger.log(`Found ${pendingReports.length} pending reports. Processing...`);
          await this.processWithConcurrency(pendingReports, 35);
          await this.delay(3000);
        }

      } catch (error) {
        this.logger.error(`Error processing reports of type ${type}:`, error.message || error);
      }
    }));
  }

  private async processWithConcurrency(items: ReportStatusEntity[], concurrency: number): Promise<void> {
    const queue = [...items];
    const tasks = new Set<Promise<void>>();

    while (queue.length > 0) {
      if (tasks.size < concurrency) {
        const reportStatus = queue.shift();
        if (reportStatus) {
          const task = this.processReportUntilComplete(reportStatus).finally(() => tasks.delete(task));
          tasks.add(task);
        }
      }
      await Promise.race(tasks);
    }
    await Promise.all(tasks);
  }

  private async processReportUntilComplete(reportStatus: ReportStatusEntity): Promise<void> {
    const reportDocumentId = reportStatus.reportId;
    let retryCount = reportStatus.retryCount;
    let backoffDelay = 1000;

    if (["COMPLETED", "PERMANENTLY_FAILED"].includes(reportStatus.status)) {
      this.logger.log(`Report ${reportDocumentId} already ${reportStatus.status}. Skipping.`);
      return;
    }

    while (true) {
      try {
        const reportDocument = await this.fetchReportDocument(reportDocumentId);
        const inventoryData = reportDocument.inventoryByAsin || reportDocument;

        if (!inventoryData || inventoryData.length === 0) {
          throw new DuplicateReportError("Empty or duplicate inventory data.");
        }

        await this.insertAsinInventoryData(inventoryData);

        await this.reportStatusRepository.update(reportStatus.id, {
          status: "COMPLETED",
          errorMessage: null,
        });

        this.logger.log(`Report ${reportDocumentId} processed successfully.`);
        return;

      } catch (error) {
        retryCount++;

        if (error instanceof DuplicateReportError) {
          await this.reportStatusRepository.update(reportStatus.id, {
            status: "PERMANENTLY_FAILED",
            errorMessage: error.message,
            retryCount,
          });
          this.logger.warn(`Duplicate report ${reportDocumentId}. Marking as PERMANENTLY_FAILED.`);
          return;
        }

        await this.reportStatusRepository.update(reportStatus.id, {
          status: "FAILED",
          errorMessage: error.message || "Unknown error",
          retryCount,
        });

        this.logger.warn(`Retrying report ${reportDocumentId}, attempt ${retryCount}. Error: ${error.message}`);

        await this.delay(backoffDelay);
        backoffDelay = Math.min(backoffDelay * 2, 16000);
      }
    }
  }

  async insertAsinInventoryData(inventoryByAsinData: any[]): Promise<void> {
    try {
      this.logger.log(`Processing ${inventoryByAsinData.length} inventory records`);

      const records = inventoryByAsinData
        .filter(data => data.asin && data.startDate === data.endDate && !isNaN(new Date(data.startDate).getTime()))
        .map(data => ({
          reportType: 'GET_VENDOR_INVENTORY_REPORT',
          startDate: new Date(data.startDate),
          endDate: new Date(data.endDate),
          asin: data.asin,
          sourceableProductOutOfStockRate: data.sourceableProductOutOfStockRate ?? 0,
          procurableProductOutOfStockRate: data.procurableProductOutOfStockRate ?? 0,
          openPurchaseOrderUnits: data.openPurchaseOrderUnits ?? 0,
          receiveFillRate: data.receiveFillRate ?? 0,
          averageVendorLeadTimeDays: data.averageVendorLeadTimeDays ?? 0,
          sellThroughRate: data.sellThroughRate ?? 0,
          unfilledCustomerOrderedUnits: data.unfilledCustomerOrderedUnits ?? 0,
          vendorConfirmationRate: data.vendorConfirmationRate ?? 0,
          netReceivedInventoryCostAmount: data.netReceivedInventoryCost?.amount ?? 0,
          netReceivedInventoryCostCurrencyCode: data.netReceivedInventoryCost?.currencyCode ?? 'USD',
          netReceivedInventoryUnits: data.netReceivedInventoryUnits ?? 0,
          sellableOnHandInventoryCostAmount: data.sellableOnHandInventoryCost?.amount ?? 0,
          sellableOnHandInventoryCostCurrencyCode: data.sellableOnHandInventoryCost?.currencyCode ?? 'USD',
          sellableOnHandInventoryUnits: data.sellableOnHandInventoryUnits ?? 0,
          unsellableOnHandInventoryCostAmount: data.unsellableOnHandInventoryCost?.amount ?? 0,
          unsellableOnHandInventoryCostCurrencyCode: data.unsellableOnHandInventoryCost?.currencyCode ?? 'USD',
          unsellableOnHandInventoryUnits: data.unsellableOnHandInventoryUnits ?? 0,
          aged90PlusDaysSellableInventoryCostAmount: data.aged90PlusDaysSellableInventoryCost?.amount ?? 0,
          aged90PlusDaysSellableInventoryCostCurrencyCode: data.aged90PlusDaysSellableInventoryCost?.currencyCode ?? 'USD',
          aged90PlusDaysSellableInventoryUnits: data.aged90PlusDaysSellableInventoryUnits ?? 0,
        }));

      if (records.length > 0) {
        const batchSize = 200;
        for (let i = 0; i < records.length; i += batchSize) {
          const batch = records.slice(i, i + batchSize);
          await this.amazonInventoryByAsinRepository.upsert(batch, ['asin', 'startDate', 'endDate']);
        }
        this.logger.log(`Saved ${records.length} inventory records.`);
      } else {
        this.logger.log('No valid records to save.');
      }
    } catch (error) {
      this.logger.error('Error saving inventory data:', error.message || error);
      throw new Error('Failed to save ASIN inventory data');
    }
  }
}
