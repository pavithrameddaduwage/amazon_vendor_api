import { Injectable, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { InjectRepository } from "@nestjs/typeorm";
import { firstValueFrom } from "rxjs";
import * as zlib from "zlib";
import { AuthService } from "src/auth.service";
import { AmazonSalesAggregate } from "./entities/amazon_sales_aggregate.entity";
import { AmazonSalesByAsin } from "./entities/amazon_sales_by_asin.entity";
import { ReportStatusEntity } from "./entities/ReportStatusEntity";
import { In, Repository } from "typeorm";
import pMap from "p-map";
import { AmazonInventoryByAsin } from "./entities/amazon_inventory_by_asin.entity";
import { AmazonInventoryReport } from "./entities/amazon_inventory_report.entity";
import { AmazonVendorInventory } from "./entities/amazon_vendor_inventory.entity";

 

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
    private readonly amazonInventoryReportRepository: Repository<AmazonInventoryReport>,
    @InjectRepository(AmazonVendorInventory)
    private readonly amazonVendorInventoryRepository: Repository<AmazonVendorInventory>,
    @InjectRepository(AmazonInventoryByAsin)
    private readonly amazonInventoryByAsinRepository: Repository<AmazonInventoryByAsin>,
  ) {}
 
  private async ensureAccessToken() {
    const currentTime = new Date().getTime();
    if (!this.currentAccessToken || currentTime >= this.tokenExpirationTime!) {
      try {
        const { access_token, expirationTime } = await this.authService.getAccessToken();
        if (!access_token) {
          throw new Error('Access token is missing.');
        }
        this.currentAccessToken = access_token;
        this.tokenExpirationTime = expirationTime;
      } catch (error) {
        console.error('Error fetching access token:', error.message || error);
        throw new Error('Unable to fetch access token.');
      }
    }
  }
 
  private dateFormat(date: Date): string {
    return date.toISOString();
  }
 
  private async fetchReports(reportType: string, startDate: Date, endDate: Date): Promise<any[]> {
    const reportPeriod = 'DAY';
    let baseFetchUrl = `${this.baseUrl}/reports/2021-06-30/reports?reportTypes=${reportType}` +
                       `&processingStatuses=DONE&marketplaceIds=ATVPDKIKX0DER&pageSize=100` +
                       `&createdSince=${this.dateFormat(startDate)}&createdUntil=${this.dateFormat(endDate)}` +
                       `&reportPeriod=${reportPeriod}&distributorView=SOURCING&sellingProgram=RETAIL`;

    let allReports: any[] = [];
    const processedReportIds = new Set<string>();
    let failedRequests: string[] = [];
    
    let requestQueue: string[] = [baseFetchUrl];

    try {
        await this.ensureAccessToken();

        while (requestQueue.length > 0) {
            let url = requestQueue.shift();
            if (!url) continue;

            let retryCount = 0;
            let backoffDelay = 1000;

            while (retryCount <= this.maxRetries) {
                try {
                    console.log(`Fetching reports from URL: ${url}`);

                    const response = await firstValueFrom(
                        this.httpService.get(url, {
                            headers: {
                                Authorization: `Bearer ${this.currentAccessToken}`,
                                'x-amz-access-token': this.currentAccessToken,
                            },
                        })
                    );

                    if (response.data.reports) {
                        for (const report of response.data.reports) {
                            const reportDocumentId = report.reportDocumentId || report.reportId || null;
                            if (reportDocumentId && !processedReportIds.has(reportDocumentId)) {
                                allReports.push(report);
                                processedReportIds.add(reportDocumentId);
                            }
                        }
                        console.log(`Fetched ${response.data.reports.length} reports.`);
                    }

                    let nextToken = response.data.nextToken || null;
                    if (nextToken) {
                        console.log(`Next token found: ${nextToken}`);
                        requestQueue.push(`${this.baseUrl}/reports/2021-06-30/reports?nextToken=${encodeURIComponent(nextToken)}`);
                    } else {
                        console.log("No next token found, stopping pagination.");
                    }

                    retryCount = 0;
                    break;

                } catch (err) {
                    if (err.response?.status === 429) {
                        retryCount++;
                        if (retryCount > this.maxRetries) {
                            console.warn(`Max retries reached for URL: ${url}. Adding to failed requests.`);
                            failedRequests.push(url);
                            break;
                        }
                        console.warn(`Rate limit hit. Retrying in ${backoffDelay}ms...`);
                        await this.delay(backoffDelay);
                        backoffDelay = Math.min(backoffDelay * 2, 32000);
                    } else {
                        console.error(`Error fetching reports: ${err.message || err}`);
                        failedRequests.push(url);
                        break;
                    }
                }
            }
        }

        if (failedRequests.length > 0) {
            console.log(`Retrying ${failedRequests.length} failed requests...`);
            requestQueue = [...failedRequests];
            failedRequests = [];
        }

    } catch (error) {
        console.error(`Error fetching reports of type ${reportType}:`, error.message || error);
    }

    console.log(`Total reports fetched: ${allReports.length}`);
    return allReports;
}


 
  private async fetchReportDocument(reportDocumentId: string, retryCount = 0): Promise<any> {
    const url = `${this.baseUrl}/reports/2021-06-30/documents/${reportDocumentId}`;
    try {
      await this.ensureAccessToken();
 
      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: {
            Authorization: `Bearer ${this.currentAccessToken}`,
            'x-amz-access-token': this.currentAccessToken,
          },
        })
      );
 
      const { url: documentUrl, compressionAlgorithm = 'GZIP' } = response.data;
 
      const documentResponse = await firstValueFrom(
        this.httpService.get(documentUrl, { responseType: 'arraybuffer' })
      );
 
      if (compressionAlgorithm === 'GZIP') {
        const decompressedData = zlib.gunzipSync(documentResponse.data);
        return JSON.parse(decompressedData.toString('utf-8'));
      }
 
      return JSON.parse(documentResponse.data.toString('utf-8'));
    } catch (error) {
      if (retryCount < this.maxRetries) {
        await this.delay(this.retryDelay);
        return this.fetchReportDocument(reportDocumentId, retryCount + 1);
      }
      throw new Error('Unable to fetch report document.');
    }
  }
 
  

  public async fetchAndStoreReports(reportType: string, startDate: Date, endDate: Date) {
    const reportTypes = [
        { type: "GET_VENDOR_INVENTORY_REPORT", process: this.insertAsinInventoryData.bind(this) },
    ];

    await Promise.all(
        reportTypes.map(async ({ type }) => {
            try {
                const reports = await this.fetchReports(type, startDate, endDate);
                if (!reports.length) return;

                const reportIds = reports.map((r) => r.reportDocumentId || r.reportId).filter(Boolean);
                if (!reportIds.length) return;

                const existingReportIds = new Set(
                    (await this.reportStatusRepository
                        .createQueryBuilder("report")
                        .select("report.reportId")
                        .where("report.reportId IN (:...ids)", { ids: reportIds })
                        .getRawMany()
                    ).map((r) => r.reportId)
                );

                const newReports = reports.filter((r) => !existingReportIds.has(r.reportDocumentId || r.reportId));
                if (newReports.length) {
                  
                    const chunkSize = 100;
                    const insertData = newReports.map((report) =>
                        this.reportStatusRepository.create({
                            reportType: type,
                            reportId: report.reportDocumentId || report.reportId,
                            startDate,
                            endDate,
                            status: "IN_PROGRESS",
                            retryCount: 0,
                        })
                    );

                    await Promise.all(
                        Array.from({ length: Math.ceil(insertData.length / chunkSize) }, (_, i) =>
                            this.reportStatusRepository.insert(insertData.slice(i * chunkSize, (i + 1) * chunkSize))
                        )
                    );
                }
 
                let reportsToProcess = await this.reportStatusRepository.find({
                    where: { status: "IN_PROGRESS" },
                });

                if (reportsToProcess.length > 0) {
                    console.log(`Processing ${reportsToProcess.length} IN_PROGRESS reports first.`);
                    await this.processWithConcurrency(reportsToProcess, 35);
                }

              
                let failedReports = await this.reportStatusRepository.find({
                    where: { status: "FAILED" },
                });

                if (failedReports.length > 0) {
                    console.log(`Processing ${failedReports.length} FAILED reports now.`);
                    await this.processWithConcurrency(failedReports, 35);
                }
            } catch (error) {
                console.error(`Error processing reports of type ${type}:`, error);
            }
        })
    );
}

private async processWithConcurrency(items: any[], concurrency: number) {
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

private async processReportUntilComplete(reportStatus: ReportStatusEntity) {
    const reportDocumentId = reportStatus.reportId;
    let retryCount = reportStatus.retryCount;
    let backoffDelay = 1000;

    while (true) {
        try {
            const reportDocument = await this.fetchReportDocument(reportDocumentId);
            if (!reportDocument) {
                throw new Error("No data in report document.");
            }
 
            const inventoryData = reportDocument.inventoryByAsin || reportDocument;

            if (!inventoryData || inventoryData.length === 0) {
                throw new Error("Empty inventory data in report.");
            }

            
            await this.insertAsinInventoryData(inventoryData);

     
            await this.reportStatusRepository.update(reportStatus.id, {
                status: "COMPLETED",
                errorMessage: null,
            });

            console.log(`Report ${reportDocumentId} processed successfully.`);
            return;
        } catch (error) {
            retryCount++;

            await this.reportStatusRepository.update(reportStatus.id, {
                status: "FAILED",
                errorMessage: error.message || "Unknown error",
                retryCount,
            });

            console.warn(`Retrying report ${reportDocumentId}, attempt ${retryCount}. Error: ${error.message}`);

            if (retryCount >= this.maxRetries) {
                console.error(`Max retries reached for report ${reportDocumentId}. Marking as FAILED.`);
                return;
            }

            await this.delay(backoffDelay);
            backoffDelay = Math.min(backoffDelay * 2, 16000);
        }
    }
}


  
async insertAsinInventoryData(inventoryByAsinData: any) {
  try {
    this.logger.log(`Processing ${inventoryByAsinData.length} inventory records...`);
    const existingRecords = await this.amazonInventoryByAsinRepository.find({
      select: ['asin', 'startDate', 'endDate']
    });

    const existingRecordSet = new Set(
      existingRecords.map(record => {
        const startDate = new Date(record.startDate).toISOString();
        const endDate = record.endDate ? new Date(record.endDate).toISOString() : '';
        return `${record.asin}-${startDate}-${endDate}`;
      })
    );

    const recordsToInsert = inventoryByAsinData
      .filter(data => {
        if (!data.asin || isNaN(new Date(data.startDate).getTime()) || data.startDate !== data.endDate) {
          return false;  
        }

        const startDate = new Date(data.startDate).toISOString();
        const endDate = new Date(data.endDate).toISOString();
        return !existingRecordSet.has(`${data.asin}-${startDate}-${endDate}`);
      })
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
        aged90PlusDaysSellableInventoryUnits: data.aged90PlusDaysSellableInventoryUnits ?? 0
      }));

    this.logger.log(`Records to insert: ${recordsToInsert.length}`);

    if (recordsToInsert.length > 0) {
      try {
        await this.amazonInventoryByAsinRepository
          .createQueryBuilder()
          .insert()
          .into('amazon_inventory_by_asin')
          .values(recordsToInsert)
          .orIgnore()  
          .execute();

        this.logger.log(`Inserted ${recordsToInsert.length} records successfully.`);
      } catch (error) {
        if (error.code === '23505') {  
          this.logger.warn('Some records were duplicates and skipped.');
        } else {
          throw error;
        }
      }
    } else {
      this.logger.log('No new records to insert.');
    }
  } catch (error) {
    this.logger.error('Error processing inventory data:', error);
    throw new Error('Failed to insert ASIN inventory data');
  }
}
private async delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
}
 

