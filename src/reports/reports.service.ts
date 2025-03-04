import { EntityManager, In, Repository } from 'typeorm';
import { firstValueFrom } from "rxjs";
import { Inject, Injectable } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { InjectRepository } from "@nestjs/typeorm";
import * as zlib from "zlib";
import { AuthService } from "../auth.service";
import { AmazonSalesAggregateRepository } from "./entities/repsitory/amazon-sales-aggregate.repository";
import { AmazonSalesByAsinRepository } from "./entities/repsitory/amazon-sales-by-asin.repository";
import { AmazonForecastByAsinRepository } from "./entities/repsitory/amazon-forecast-by-asin.repository";
import { AmazonForecastingReportRepository } from "./entities/repsitory/amazon-forecasting-report.repository";
import { AmazonInventoryByAsinRepository } from "./entities/repsitory/amazon-inventory-by-asin.repository";
import { AmazonInventoryReportRepository } from "./entities/repsitory/amazon-inventory-report.repository";
import { AmazonVendorInventoryRepository } from "./entities/repsitory/amazon-vendor-inventory.repository";
import { DeepPartial } from "typeorm";
import { AmazonForecastingReport } from "./entities/amazon_forecasting_report.entity";
import { AmazonSalesReportRepository } from "./entities/repsitory/amazon-sales-report.repository";
import { AmazonSalesAggregate } from './entities/amazon_sales_aggregate.entity';
import { AmazonSalesReport } from './entities/amazon_sales_report.entity';
import { AmazonSalesByAsin } from './entities/amazon_sales_by_asin.entity';
import { AmazonForecastByAsin } from './entities/amazon_forecasting_by_asin.entity';
import { AmazonInventoryByAsin } from './entities/amazon_inventory_by_asin.entity';
import { AmazonInventoryReport } from './entities/amazon_inventory_report.entity';
import { AmazonVendorInventory } from './entities/amazon_vendor_inventory.entity';
import { ReportStatusEntity } from './entities/ReportStatusEntity';
 
 
@Injectable()
@Injectable()
export class ReportsService {
  private currentAccessToken: string | null = null;
  private tokenExpirationTime: number | null = null;
  private readonly baseUrl = 'https://sellingpartnerapi-na.amazon.com';
  private readonly maxRetries = 5;
  private readonly retryDelay = 5000;
 
  constructor(
    private readonly httpService: HttpService,
    private readonly authService: AuthService,
    @Inject(EntityManager) private readonly entityManager: EntityManager,
    @InjectRepository(AmazonInventoryReport)
    private readonly amazonInventoryReportRepository: Repository<AmazonInventoryReport>,
    @InjectRepository(AmazonVendorInventory)
    private readonly amazonVendorInventoryRepository: Repository<AmazonVendorInventory>,
    @InjectRepository(AmazonInventoryByAsin)
    private readonly amazonInventoryByAsinRepository: Repository<AmazonInventoryByAsin>,
    @InjectRepository(AmazonSalesReport)
    private readonly salesReportRepository: Repository<AmazonSalesReport>,
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
 
  private getSundayOfWeek(date: Date): Date {
    const sunday = new Date(date);
    sunday.setDate(sunday.getDate() - sunday.getDay());
    sunday.setHours(0, 0, 0, 0);
    return sunday;
  }
 
  private getSaturdayOfWeek(date: Date): Date {
    const saturday = new Date(date);
    saturday.setDate(saturday.getDate() + (6 - saturday.getDay()));
    saturday.setHours(23, 59, 59, 999);
    return saturday;
  }
 
  private async fetchReports(reportType: string, startDate: Date, endDate: Date) {
    const reportPeriod = 'WEEK';
    
    let url = `${this.baseUrl}/reports/2021-06-30/reports?reportTypes=${reportType}` +
              `&processingStatuses=DONE&marketplaceIds=ATVPDKIKX0DER&pageSize=100` +
              `&createdSince=${this.dateFormat(startDate)}&createdUntil=${this.dateFormat(endDate)}` +
              `&reportPeriod=${reportPeriod}&distributorView=SOURCING&sellingProgram=RETAIL`;

    let allReports: any[] = [];
    const processedReportIds = new Set<string>();
    let retryCount = 0;
    let backoffDelay = 1000;

    try {
        await this.ensureAccessToken();

        while (url) {
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
                }

                // Pagination
                url = response.data.nextToken
                    ? `${this.baseUrl}/reports/2021-06-30/reports?reportTypes=${reportType}` +
                      `&processingStatuses=DONE&marketplaceIds=ATVPDKIKX0DER&pageSize=100` +
                      `&createdSince=${this.dateFormat(startDate)}&createdUntil=${this.dateFormat(endDate)}` +
                      `&reportPeriod=${reportPeriod}&distributorView=SOURCING&sellingProgram=RETAIL` +
                      `&nextToken=${encodeURIComponent(response.data.nextToken)}`
                    : '';

                await this.delay(backoffDelay);
                backoffDelay = Math.min(backoffDelay * 2, 16000);
            } catch (err) {
                if (err.response?.status === 429) {
                    retryCount++;
                    if (retryCount > this.maxRetries) {
                        throw new Error('Max retries reached. Could not fetch reports.');
                    }
                    await this.delay(backoffDelay);
                    backoffDelay *= 2;
                } else {
                    throw err;
                }
            }
        }
    } catch (error) {
        console.error(`Error fetching reports of type ${reportType}:`, error.message || error);
    }

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
 
  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
 
  public async fetchAndStoreReports(reportType: string, startDate: Date, endDate: Date) {
    const reportTypes = [
        { type: 'GET_VENDOR_SALES_REPORT', process: this.processVendorSalesReportWithoutReport.bind(this) },
            // { type: 'GET_VENDOR_INVENTORY_REPORT', process: this.insertAsinInventoryData.bind(this) },  
            // { type: 'GET_VENDOR_FORECASTING_REPORT', process: this.processVendorForecastingReport.bind(this) },
    ];

    let completedSteps = new Set();

    for (const { type, process } of reportTypes) {
        if (completedSteps.has(type)) {
            console.log(`✅ ${type} already processed. Skipping...`);
            continue;
        }

        try {
            console.log(`🚀 Fetching reports of type: ${type}`);
            const reports = await this.fetchReports(type, startDate, endDate);
            console.log(`✅ Fetched ${reports.length} reports of type: ${type}`);

            const processPromises = reports.map(async (report) => {
                const reportDocumentId = report.reportDocumentId || report.reportId || null;
                if (!reportDocumentId) {
                    console.log('❌ No report document ID found. Skipping...');
                    return;
                }

                let reportStatus = new ReportStatusEntity();
                reportStatus.reportType = type;
                reportStatus.startDate = startDate;
                reportStatus.endDate = endDate;
                reportStatus.status = 'IN_PROGRESS';

                reportStatus = await this.reportStatusRepository.save(reportStatus);

                try {
                    console.log(`🚀 Fetching report document with ID: ${reportDocumentId}`);
                    const reportDocument = await this.fetchReportDocument(reportDocumentId);
                    if (!reportDocument) {
                        console.log(`❌ No data in the report document for ${reportDocumentId}.`);

                        await this.reportStatusRepository.update(reportStatus.id, {
                            status: 'FAILED',
                            errorMessage: 'No data in report document.',
                            retryCount: reportStatus.retryCount + 1,
                        });

                        return;
                    }

                    const { salesAggregate, salesByAsin, inventoryByAsin } = reportDocument;
                    const reportExists = await this.amazonInventoryReportRepository.findOne({ where: { reportType: type } });

                    if (!reportExists) {
                        const reportData = new AmazonInventoryReport();
                        reportData.reportType = type;
                        await this.amazonInventoryReportRepository.save(reportData);
                        console.log(`✅ Report of type ${type} inserted.`);
                    } else {
                        console.log(`⚠️ Report of type ${type} already exists. Skipping insertion.`);
                    }

                    const tasks = [];
                    if (inventoryByAsin) {
                        console.log('🚀 Processing inventory by ASIN data...');
                        tasks.push(this.insertAsinInventoryData(inventoryByAsin));
                    }
                    if (salesAggregate || salesByAsin) {
                        console.log('🚀 Processing sales data...');
                        tasks.push(this.processVendorSalesReportWithoutReport({ salesAggregate, salesByAsin }));
                    }

                    await Promise.all(tasks);
                    console.log(`✅ Completed processing for report ${reportDocumentId}`);

                    await this.reportStatusRepository.update(reportStatus.id, {
                        status: 'COMPLETED',
                    });

                } catch (docError) {
                    console.error(`❌ Error fetching report document (ID: ${reportDocumentId}):`, docError.message || docError);

                    await this.reportStatusRepository.update(reportStatus.id, {
                        status: 'FAILED',
                        errorMessage: docError.message || 'Unknown error',
                        retryCount: reportStatus.retryCount + 1,
                    });
                }
            });

            await Promise.all(processPromises);
            completedSteps.add(type);
            console.log(`✅ Completed processing for ${type}.`);
        } catch (error) {
            console.error(`❌ Error processing reports of type ${type}:`, error.message || error);
        }
    }
    console.log('✅ All report types processed.');
}


 
async insertAsinInventoryData(inventoryByAsinData: any) {
  try {
    console.log('🚀 Processing inventory by ASIN data...');
   
    // Retrieve existing records to avoid duplicates
    const existingRecords = await this.amazonInventoryByAsinRepository.find({
      select: ['asin', 'startDate', 'endDate']
    });
 
    const existingRecordSet = new Set(
      existingRecords.map(record => {
        const startDate = record.startDate instanceof Date ? record.startDate.toISOString() : new Date(record.startDate).toISOString();
        const endDate = record.endDate ? (record.endDate instanceof Date ? record.endDate.toISOString() : new Date(record.endDate).toISOString()) : '';
        return `${record.asin}-${startDate}-${endDate}`;
      })
    );
 
    const recordsToInsert = inventoryByAsinData
      .filter(data => {
        if (!data.asin || isNaN(new Date(data.startDate).getTime())) return false;
       
        const startDate = new Date(data.startDate);
        const endDate = data.endDate ? new Date(data.endDate) : null;
       
        if (isNaN(startDate.getTime()) || (endDate && isNaN(endDate.getTime()))) {
          console.warn(`⚠️ Skipping invalid date (ASIN: ${data.asin}, startDate: ${data.startDate}, endDate: ${data.endDate})`);
          return false;
        }
       
        const recordKey = `${data.asin}-${startDate.toISOString()}-${endDate ? endDate.toISOString() : ''}`;
       
        if (existingRecordSet.has(recordKey)) {
          console.warn(`⚠️ Skipping duplicate (ASIN: ${data.asin}, startDate: ${data.startDate}, endDate: ${data.endDate})`);
          return false;
        }
        return true;
      })
      .map(data => ({
        reportType: 'GET_VENDOR_INVENTORY_REPORT',
        startDate: new Date(data.startDate),
        endDate: data.endDate ? new Date(data.endDate) : null,
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
 
    if (recordsToInsert.length > 0) {
      await this.amazonInventoryByAsinRepository.save(recordsToInsert, { chunk: 100 });
      console.log(`✅ Inserted ${recordsToInsert.length} new inventory records.`);
    } else {
      console.log('⚠️ No new records to insert.');
    }
  } catch (error) {
    console.error('❌ Error during inventory data processing:', error);
    throw new Error('Failed to insert ASIN inventory data');
  }
}
 
 
 

 

async processVendorSalesReportWithoutReport(data: any) {
  try {
    if (!data || typeof data !== "object") {
      console.warn("⚠️ Invalid or empty data. Skipping processing.");
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

    // 🔹 Process Sales Aggregate
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
          // ✅ Ensure no null values
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
          // 🆕 Insert new record
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

    // 🔹 Process Sales by ASIN
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
          // ✅ Ensure no null values
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
          // 🆕 Insert new record
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





  
 
 
 
 
 
 
 
 
//  // Process and save Vendor Forecasting Report
// private async processVendorForecastingReport(data: any) {
//   try {
//     if (!data || typeof data !== 'object') {
//       console.warn('Received invalid or empty data. Processing with default values.');
//       data = {};  
//     }
 
//     console.log('Fetched Vendor Forecasting Data:', JSON.stringify(data, null, 2));
 
//     const forecastingData = data.forecasts || [];
 
//     for (const forecast of forecastingData) {
//       try {
       
//         const newForecast: DeepPartial<AmazonForecastingReport> = {
//           reportType: forecast.reportType || 'UNKNOWN',  
//           sellingProgram: forecast.sellingProgram || 'UNKNOWN',  
//           lastUpdatedDate: forecast.lastUpdatedDate ? new Date(forecast.lastUpdatedDate) : new Date(),  
//           marketplaceIds: forecast.marketplaceIds || [], // Default to empty array if not provided
//           startDate: forecast.startDate || null, // Nullable field
//           endDate: forecast.endDate || null, // Nullable field
//         };
 
//         // Save the report
//         const savedForecast = await this.amazonForecastingReportRepository.save(newForecast);
 
//         // Process Forecasts by ASIN Data (if available)
//         if (forecast.forecastsByAsin && Array.isArray(forecast.forecastsByAsin)) {
//           for (const asinForecast of forecast.forecastsByAsin) {
//             try {
//               // Create a new forecast by ASIN, linking it to the main forecast report
//               const newAsinForecast = this.amazonForecastByAsinRepository.create({
//                 report: savedForecast, // Link the forecastByAsin to the saved forecasting report
//                 forecastGenerationDate: asinForecast.forecastGenerationDate ? new Date(asinForecast.forecastGenerationDate) : new Date(), // Ensure date is properly formatted
//                 asin: asinForecast.asin || '', // Default to an empty string if ASIN is not provided
//                 startDate: asinForecast.startDate ? new Date(asinForecast.startDate) : null, // Nullable field, ensure date format
//                 endDate: asinForecast.endDate ? new Date(asinForecast.endDate) : null, // Nullable field, ensure date format
//                 meanForecastUnits: asinForecast.meanForecastUnits || 0, // Default to 0 if not provided
//                 p70ForecastUnits: asinForecast.p70ForecastUnits || 0, // Default to 0 if not provided
//                 p80ForecastUnits: asinForecast.p80ForecastUnits || 0, // Default to 0 if not provided
//                 p90ForecastUnits: asinForecast.p90ForecastUnits || 0, // Default to 0 if not provided
//               });
 
//               // Save the ASIN-specific forecast
//               await this.amazonForecastByAsinRepository.save(newAsinForecast);
//             } catch (asinError) {
//               console.error('Error processing individual ASIN forecast data:', asinError.message, asinError.stack);
//               // Continue processing other ASIN forecasts even if one fails
//             }
//           }
//         }
//       } catch (forecastError) {
//         console.error('Error processing individual forecast data:', forecastError.message, forecastError.stack);
//         // Continue processing other forecasts even if one fails
//       }
//     }
//   } catch (error) {
//     console.error('Error processing Vendor Forecasting Report:', error.message, error.stack);
//     throw new Error('Failed to process Vendor Forecasting Report.');
//   }
// }
 
 
 
 
}