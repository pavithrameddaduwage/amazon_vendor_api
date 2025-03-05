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

@Injectable()
export class SalesReportService {
  private currentAccessToken: string | null = null;
  private tokenExpirationTime: number | null = null;
  private readonly baseUrl = 'https://sellingpartnerapi-na.amazon.com';
  private readonly maxRetries = 5;
  private readonly retryDelay = 5000;
 
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
    let url = `${this.baseUrl}/reports/2021-06-30/reports?reportTypes=${reportType}` +
              `&processingStatuses=DONE&marketplaceIds=ATVPDKIKX0DER&pageSize=100` +
              `&createdSince=${this.dateFormat(startDate)}&createdUntil=${this.dateFormat(endDate)}` +
              `&reportPeriod=${reportPeriod}&distributorView=SOURCING&sellingProgram=RETAIL`;

    let allReports: any[] = [];
    const processedReportIds = new Set<string>();
    let retryCount = 0;
    let backoffDelay = 1000;
    let requestCount = 0;
    let nextToken: string | null = null;   

    try {
        await this.ensureAccessToken();

        while (url) {
            requestCount++;
            console.log(`Fetching reports (Request #${requestCount}) from URL: ${url}`);

            try {
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
                    console.log(`Fetched ${response.data.reports.length} reports in Request #${requestCount}`);
                }
 
                nextToken = response.data.nextToken || null;
                if (nextToken) {
                    console.log(`Next token found: ${nextToken}`);
                    url = `${this.baseUrl}/reports/2021-06-30/reports?nextToken=${encodeURIComponent(nextToken)}`;
                } else {
                    console.log("No next token found, stopping pagination.");
                    url = null;   
                }

               
                retryCount = 0;
                backoffDelay = 1000;

            } catch (err) {
                if (err.response?.status === 429) {   
                    retryCount++;
                    if (retryCount > this.maxRetries) {
                        throw new Error('Max retries reached. Could not fetch reports.');
                    }
                    console.warn(`Rate limit hit. Retrying in ${backoffDelay}ms...`);
                    await this.delay(backoffDelay);
                    backoffDelay = Math.min(backoffDelay * 2, 32000);   
                } else {
                    console.error(`Error fetching reports: ${err.message || err}`);
                    throw err;
                }
            }
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
 
  public async fetchAndStoreReports(startDate: Date, endDate: Date) {
    const reportTypes = [
        { type: 'GET_VENDOR_SALES_REPORT', process: this.processVendorSalesReportWithoutReport.bind(this) },
    ];
 
    for (const { type } of reportTypes) {
        try {
            const reports = await this.fetchReports(type, startDate, endDate);
 
            const processPromises = reports.map(async (report) => {
                const reportDocumentId = report.reportDocumentId || report.reportId || null;
                if (!reportDocumentId) return;
 
                let reportStatus = await this.reportStatusRepository.findOne({ where: { reportId: reportDocumentId } });
 
                if (reportStatus && reportStatus.status === 'COMPLETED') return;
 
                if (!reportStatus) {
                    reportStatus = new ReportStatusEntity();
                    reportStatus.reportType = type;
                    reportStatus.reportId = reportDocumentId;
                    reportStatus.startDate = startDate;
                    reportStatus.endDate = endDate;
                    reportStatus.status = 'IN_PROGRESS';
                    reportStatus.retryCount = 0;
                    reportStatus = await this.reportStatusRepository.save(reportStatus);
                }
 
                await this.processReportWithRetries(reportStatus);
            });
 
            await Promise.all(processPromises);
        } catch (error) {
            console.error(`Error processing reports of type ${type}:`, error.message || error);
        }
    }
}
 
private async processReportWithRetries(reportStatus: ReportStatusEntity) {
    const reportDocumentId = reportStatus.reportId;
    let retryCount = reportStatus.retryCount;
    let backoffDelay = 1000;
 
    while (true) {
        try {
            const reportDocument = await this.fetchReportDocument(reportDocumentId);
            if (!reportDocument) {
                await this.reportStatusRepository.update(reportStatus.id, {
                    status: 'FAILED',
                    errorMessage: 'No data in report document.',
                    retryCount: retryCount + 1,
                });
 
                retryCount++;
                await this.delay(backoffDelay);
                backoffDelay = Math.min(backoffDelay * 2, 16000);
                continue;
            }
 
            const { salesAggregate, salesByAsin } = reportDocument;
            const tasks = [];

            if (salesAggregate || salesByAsin) {
                tasks.push(this.processVendorSalesReportWithoutReport({ salesAggregate, salesByAsin }));
            }
 
            await Promise.all(tasks);
 
            await this.reportStatusRepository.update(reportStatus.id, {
                status: 'COMPLETED',
                errorMessage: null,
            });
 
            console.log(`Successfully processed report ${reportDocumentId}`);
            break;
 
        } catch (docError) {
            console.error(`Error processing report ${reportDocumentId}:`, docError.message || docError);
 
            await this.reportStatusRepository.update(reportStatus.id, {
                status: 'FAILED',
                errorMessage: docError.message || 'Unknown error',
                retryCount: retryCount + 1,
            });
 
            retryCount++;
            await this.delay(backoffDelay);
            backoffDelay = Math.min(backoffDelay * 2, 16000);
        }
    }
}
 

async processVendorSalesReportWithoutReport(data: any) {
    try {
      if (!data || typeof data !== "object") {
        console.warn("Invalid or empty data. Skipping processing.");
        return;
      }
  
      let salesAggregate: any[] = [];
      let salesByAsin: any[] = [];
  
      if (Array.isArray(data)) {
        salesByAsin = data;
      } else {
        salesAggregate = data.salesAggregate ?? [];
        salesByAsin = data.salesByAsin ?? [];
      }
  

      
      if (salesAggregate.length > 0) {
        const existingAggregates = await this.salesAggregateRepository.find({
          where: {
            startDate: In(salesAggregate.map((a) => a.startDate)),
            endDate: In(salesAggregate.map((a) => a.endDate)),
          },
        });
  
        const existingAggregateMap = new Map(
          existingAggregates.map((a) => [`${a.startDate}-${a.endDate}`, a])
        );
  
        for (const aggregate of salesAggregate) {
          const key = `${aggregate.startDate}-${aggregate.endDate}`;
          const existing = existingAggregateMap.get(key);
  
          if (existing) {
        
            
            Object.assign(existing, {
              customerReturns: aggregate.customerReturns ?? existing.customerReturns ?? 0,
              orderedRevenueAmount: aggregate.orderedRevenue?.amount ?? existing.orderedRevenueAmount ?? 0,
              orderedRevenueCurrency: aggregate.orderedRevenue?.currencyCode ?? existing.orderedRevenueCurrency ?? "USD",
              orderedUnits: aggregate.orderedUnits ?? existing.orderedUnits ?? 0,
              shippedCogsAmount: aggregate.shippedCogs?.amount ?? existing.shippedCogsAmount ?? 0,
              shippedCogsCurrency: aggregate.shippedCogs?.currencyCode ?? existing.shippedCogsCurrency ?? "USD",
              shippedRevenueAmount: aggregate.shippedRevenue?.amount ?? existing.shippedRevenueAmount ?? 0,
              shippedRevenueCurrency: aggregate.shippedRevenue?.currencyCode ?? existing.shippedRevenueCurrency ?? "USD",
              shippedUnits: aggregate.shippedUnits ?? existing.shippedUnits ?? 0,
            });
            await this.salesAggregateRepository.save(existing);
          } else {
         
            
            const newAggregate = Object.assign(new AmazonSalesAggregate(), {
              startDate: aggregate.startDate ?? null,
              endDate: aggregate.endDate ?? null,
              customerReturns: aggregate.customerReturns ?? 0,
              orderedRevenueAmount: aggregate.orderedRevenue?.amount ?? 0,
              orderedRevenueCurrency: aggregate.orderedRevenue?.currencyCode ?? "USD",
              orderedUnits: aggregate.orderedUnits ?? 0,
              shippedCogsAmount: aggregate.shippedCogs?.amount ?? 0,
              shippedCogsCurrency: aggregate.shippedCogs?.currencyCode ?? "USD",
              shippedRevenueAmount: aggregate.shippedRevenue?.amount ?? 0,
              shippedRevenueCurrency: aggregate.shippedRevenue?.currencyCode ?? "USD",
              shippedUnits: aggregate.shippedUnits ?? 0,
            });
            await this.salesAggregateRepository.save(newAggregate);
          }
        }
      }
  
     
      
      if (salesByAsin.length > 0) {
        const existingAsinRecords = await this.salesByAsinRepository.find({
          where: {
            asin: In(salesByAsin.map((a) => a.asin)),
            startDate: In(salesByAsin.map((a) => a.startDate)),
          },
        });
  
        const existingAsinMap = new Map(
          existingAsinRecords.map((record) => [`${record.asin}-${record.startDate}`, record])
        );
  
        for (const asinData of salesByAsin) {
          if (!asinData.asin) continue;
          const key = `${asinData.asin}-${asinData.startDate}`;
          const existing = existingAsinMap.get(key);
  
          if (existing) {
      
            
            Object.assign(existing, {
              startDate: asinData.startDate ?? existing.startDate,
              endDate: asinData.endDate ?? existing.endDate,
              customerReturns: asinData.customerReturns ?? existing.customerReturns ?? 0,
              orderedRevenueAmount: asinData.orderedRevenue?.amount ?? existing.orderedRevenueAmount ?? 0,
              orderedRevenueCurrency: asinData.orderedRevenue?.currencyCode ?? existing.orderedRevenueCurrency ?? "USD",
              orderedUnits: asinData.orderedUnits ?? existing.orderedUnits ?? 0,
              shippedCogsAmount: asinData.shippedCogs?.amount ?? existing.shippedCogsAmount ?? 0,
              shippedCogsCurrency: asinData.shippedCogs?.currencyCode ?? existing.shippedCogsCurrency ?? "USD",
              shippedRevenueAmount: asinData.shippedRevenue?.amount ?? existing.shippedRevenueAmount ?? 0,
              shippedRevenueCurrency: asinData.shippedRevenue?.currencyCode ?? existing.shippedRevenueCurrency ?? "USD",
              shippedUnits: asinData.shippedUnits ?? existing.shippedUnits ?? 0,
            });
            await this.salesByAsinRepository.save(existing);
          } else {
          
            
            const newAsinRecord = Object.assign(new AmazonSalesByAsin(), {
              asin: asinData.asin ?? null,
              startDate: asinData.startDate ?? null,
              endDate: asinData.endDate ?? null,
              customerReturns: asinData.customerReturns ?? 0,
              orderedRevenueAmount: asinData.orderedRevenue?.amount ?? 0,
              orderedRevenueCurrency: asinData.orderedRevenue?.currencyCode ?? "USD",
              orderedUnits: asinData.orderedUnits ?? 0,
              shippedCogsAmount: asinData.shippedCogs?.amount ?? 0,
              shippedCogsCurrency: asinData.shippedCogs?.currencyCode ?? "USD",
              shippedRevenueAmount: asinData.shippedRevenue?.amount ?? 0,
              shippedRevenueCurrency: asinData.shippedRevenue?.currencyCode ?? "USD",
              shippedUnits: asinData.shippedUnits ?? 0,
            });
            await this.salesByAsinRepository.save(newAsinRecord);
          }
        }
      }
    } catch (err: any) {
      if (err.code === "23505") {
        console.warn(`⚠️ Duplicate entry detected: ${err.detail.match(/\((.*?)\)/)?.[1]}`);
      } else {
        console.warn("⚠️ An unexpected error occurred while processing the sales report.", err);
      }
    }
  }


  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
 

 

