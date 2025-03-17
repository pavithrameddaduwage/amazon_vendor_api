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
    let baseFetchUrl = `${this.baseUrl}/reports/2021-06-30/reports?reportTypes=${reportType}` +
                       `&processingStatuses=DONE&marketplaceIds=ATVPDKIKX0DER&pageSize=100` +
                       `&createdSince=${this.dateFormat(startDate)}&createdUntil=${this.dateFormat(endDate)}` +
                       `&reportPeriod=${reportPeriod}&distributorView=SOURCING&sellingProgram=RETAIL`;

    let allReports: any[] = [];
    const processedReportIds = new Set<string>();
    let failedRequests: string[] = [];
    let tempFailedReports: string[] = [];
    
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
                            const reportDocumentId = report.reportDocumentId || null;
                    
                           
                    
                            if (reportDocumentId && !processedReportIds.has(reportDocumentId)) {
                                allReports.push({ reportDocumentId });  
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

        if (failedRequests.length > 0 || tempFailedReports.length > 0) {
            console.log(`Retrying ${failedRequests.length} failed requests and ${tempFailedReports.length} failed reports...`);
            requestQueue = [...failedRequests];
            failedRequests = [];
            tempFailedReports = [];
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
        console.error(`Error fetching report document: ${error.message}`);
        if (retryCount < this.maxRetries) {
            console.warn(`Retrying... Attempt ${retryCount + 1}`);
            await this.delay(this.retryDelay);
            return this.fetchReportDocument(reportDocumentId, retryCount + 1);
        }
        throw new Error('Unable to fetch report document.');
    }
}

    public async fetchAndStoreReports(startDate: Date, endDate: Date) {
        const reportTypes = [
            { type: "GET_VENDOR_SALES_REPORT", process: this.processVendorSalesReportWithoutReport.bind(this) },
        ];

        for (const { type, process } of reportTypes) {
            try {
                const reports = await this.fetchReports(type, startDate, endDate);
                if (!reports.length) continue;

                const reportIds = reports.map((r) => r.reportDocumentId || r.reportId).filter(Boolean);
                if (!reportIds.length) continue;

                const existingReports = await this.reportStatusRepository.find({
                    where: { reportId: In(reportIds) },
                    select: ["reportId"],
                });

                const existingReportIds = new Set(existingReports.map((r) => r.reportId));

                const newReports = reports
                    .filter((r) => !existingReportIds.has(r.reportDocumentId || r.reportId))
                    .map((report) => ({
                        reportType: type,
                        reportId: report.reportDocumentId || report.reportId,
                        startDate,
                        endDate,
                        status: "IN_PROGRESS",
                        retryCount: 0,
                    }));

                if (newReports.length) {
                    await this.reportStatusRepository.upsert(newReports, ["reportId"]);
                }

                await this.processReportsSequentially();
            } catch (error) {
                console.error(`Error processing reports of type ${type}:`, error);
            }
        }
    }

    private async processReportsSequentially() {
        let reportsToProcess = await this.reportStatusRepository.find({ where: { status: "IN_PROGRESS" } });

        for (const reportStatus of reportsToProcess) {
            await this.processReportUntilComplete(reportStatus);
        }

        let failedReports = await this.reportStatusRepository.find({ where: { status: "FAILED" } });

        for (const reportStatus of failedReports) {
            await this.processReportUntilComplete(reportStatus);
        }
    }

    private async processReportUntilComplete(reportStatus: any) {
        const reportDocumentId = reportStatus.reportId;
        let retryCount = reportStatus.retryCount;
        let backoffDelay = 500;

        while (true) {
            try {
                const reportDocument = await this.fetchReportDocument(reportDocumentId);
                if (!reportDocument) throw new Error("No data in report document.");

                const { salesAggregate, salesByAsin } = reportDocument;

                if (salesAggregate || salesByAsin) {
                    await this.processVendorSalesReportWithoutReport({ salesAggregate, salesByAsin });
                }

                await this.reportStatusRepository.update(reportStatus.id, {
                    status: "COMPLETED",
                    errorMessage: null,
                });

                return;
            } catch (error) {
                retryCount++;
                console.warn(`Retrying report ${reportDocumentId}, attempt ${retryCount}. Error: ${error.message}`);

                await this.reportStatusRepository.update(reportStatus.id, {
                    status: "FAILED",
                    errorMessage: error.message || "Unknown error",
                    retryCount,
                });

                await this.delay(backoffDelay);
                backoffDelay = Math.min(backoffDelay * 2, 8000);
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
                salesAggregate = salesAggregate.filter(a => a.startDate === a.endDate);
                if (salesAggregate.length > 0) {
                    const newAggregates = salesAggregate.map((aggregate) => ({
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
                    }));

                    await this.salesAggregateRepository.upsert(newAggregates, ["startDate", "endDate"]);
                }
            }

            if (salesByAsin.length > 0) {
                salesByAsin = salesByAsin.filter(a => a.startDate === a.endDate);
                if (salesByAsin.length > 0) {
                    const newAsinRecords = salesByAsin.map((asinData) => ({
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
                    }));

                    await this.salesByAsinRepository.upsert(newAsinRecords, ["asin", "startDate", "endDate"]);
                }
            }
        } catch (err: any) {
            console.warn("An unexpected error occurred while processing the sales report.", err);
        }
    }

    private async delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

 

