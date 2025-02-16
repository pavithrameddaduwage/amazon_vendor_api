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
    const minStartDate = new Date('2025-02-03T00:00:00Z');

    if (startDate < minStartDate) startDate = minStartDate;

    const dataStartTime = this.getSundayOfWeek(startDate).toISOString();
    const dataEndTime = this.getSaturdayOfWeek(endDate).toISOString();

    let url = `${this.baseUrl}/reports/2021-06-30/reports?reportTypes=${reportType}` +
              `&processingStatuses=DONE&marketplaceIds=ATVPDKIKX0DER&pageSize=100` +
              `&createdSince=${this.dateFormat(startDate)}&createdUntil=${this.dateFormat(endDate)}` +
              `&reportPeriod=${reportPeriod}&dataStartTime=${dataStartTime}&dataEndTime=${dataEndTime}` +
              `&distributorView=SOURCING&sellingProgram=RETAIL`;

    let allReports: any[] = [];
    const processedReportIds = new Set<string>();
    let retryCount = 0;
    let backoffDelay = 1000;

    try {
      await this.ensureAccessToken();

      do {
        try {
          const response = await firstValueFrom(
            this.httpService.get(url, {
              headers: {
                Authorization: `Bearer ${this.currentAccessToken}`,
                'x-amz-access-token': this.currentAccessToken,
              },
            })
          );

          console.log(`API response for ${reportType}:`, response.data);

          if (response.data.reports) {
            for (const report of response.data.reports) {
              const reportDocumentId = report.reportDocumentId || report.reportId || null;

              if (reportDocumentId && processedReportIds.has(reportDocumentId)) {
                console.log(`Skipping already processed report: ${reportDocumentId}`);
                continue;
              }

              allReports.push(report);
              if (reportDocumentId) {
                processedReportIds.add(reportDocumentId);
              }
            }
          }

          const nextToken = response.data.nextToken;
          if (nextToken) {
            url = `${this.baseUrl}/reports/2021-06-30/reports?reportTypes=${reportType}` +
                  `&processingStatuses=DONE&marketplaceIds=ATVPDKIKX0DER&pageSize=100` +
                  `&createdSince=${this.dateFormat(startDate)}&createdUntil=${this.dateFormat(endDate)}` +
                  `&reportPeriod=${reportPeriod}&dataStartTime=${dataStartTime}&dataEndTime=${dataEndTime}` +
                  `&distributorView=SOURCING&sellingProgram=RETAIL` +
                  `&nextToken=${encodeURIComponent(nextToken)}`;
          } else {
            break;
          }

          await this.delay(backoffDelay);
          backoffDelay = Math.min(backoffDelay * 2, 16000);
        } catch (err) {
          if (err.response && err.response.status === 429) {
            console.error(`Quota exceeded. Retrying after backoff...`);
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
      } while (true);
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
      { type: 'GET_VENDOR_INVENTORY_REPORT', process: this.insertAsinInventoryData.bind(this) },  // Inventory first
      { type: 'GET_VENDOR_SALES_REPORT', process: this.processVendorSalesReportWithoutReport.bind(this) },  // Sales second
      { type: 'GET_VENDOR_FORECAST_REPORT', process: this.processVendorSalesReportWithoutReport.bind(this) },  // Forecast last
    ];

    let completedSteps = new Set(); // Track completed report types

    // Process each report in order
    for (const { type, process } of reportTypes) {
      if (completedSteps.has(type)) {
        console.log(`✅ ${type} already processed. Skipping...`);
        continue;
      }

      try {
        console.log(`🚀 Fetching reports of type: ${type}`);
        const reports = await this.fetchReports(type, startDate, endDate); // Pass startDate and endDate here
        console.log(`✅ Fetched ${reports.length} reports of type: ${type}`);

        for (const report of reports) {
          const reportDocumentId = report.reportDocumentId || report.reportId || null;

          if (reportDocumentId) {
            try {
              console.log(`🚀 Fetching report document with ID: ${reportDocumentId}`);
              const reportDocument = await this.fetchReportDocument(reportDocumentId);
              if (!reportDocument) {
                console.log(`❌ No data in the report document for ${reportDocumentId}.`);
                continue;
              }

              const { salesAggregate, salesByAsin, inventoryByAsin } = reportDocument;

              // Insert the report first to ensure it's not duplicated
              const reportExists = await this.amazonInventoryReportRepository.findOne({ where: { reportType: type } });
              if (reportExists) {
                console.log(`⚠️ Report of type ${type} already exists. Skipping report insertion.`);
              } else {
                const reportData = new AmazonInventoryReport();
                reportData.reportType = type;
                await this.amazonInventoryReportRepository.save(reportData);
                console.log(`✅ Report of type ${type} inserted.`);
              }

              // Process inventory data in parallel with sales/forecast data
              const promises = [];

              if (inventoryByAsin) {
                console.log('🚀 Processing inventory by ASIN data...');
                promises.push(this.insertAsinInventoryData(inventoryByAsin));
              }

              if (salesAggregate || salesByAsin) {
                console.log('🚀 Processing sales data...');
                promises.push(this.processVendorSalesReportWithoutReport({ salesAggregate, salesByAsin }));
              }

              if (salesAggregate || salesByAsin) {
                console.log('🚀 Processing forecast data...');
                promises.push(this.processVendorSalesReportWithoutReport({ salesAggregate, salesByAsin })); // Reuse logic for forecast
              }

              // Wait for all processing to complete
              await Promise.all(promises);
              console.log(`✅ Completed all processing steps for report type: ${type}`);

            } catch (docError) {
              console.error(`❌ Error fetching report document (ID: ${reportDocumentId}):`, docError.message || docError);
            }
          } else {
            console.log('❌ No report document ID found.');
          }
        }

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
      existingRecords.map(record => 
        `${record.asin}-${record.startDate.toISOString()}-${record.endDate ? record.endDate.toISOString() : ''}`
      )
    );

    const recordsToInsert = inventoryByAsinData
      .filter(data => {
        if (!data.asin || isNaN(new Date(data.startDate).getTime())) return false;
        const recordKey = `${data.asin}-${new Date(data.startDate).toISOString()}-${data.endDate ? new Date(data.endDate).toISOString() : ''}`;
        
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
      // Validate incoming data
      if (!data || typeof data !== 'object') {
        console.warn('⚠️ Received invalid or empty data. Skipping processing.');
        return;
      }
  
      console.log('🔹 Received Vendor Sales Data:', JSON.stringify(data, null, 2));
  
      let salesAggregate = [];
      let salesByAsin = [];
  
      // Extract data from the incoming payload
      if (Array.isArray(data)) {
        salesByAsin = data;
      } else {
        salesAggregate = data.salesAggregate || [];
        salesByAsin = data.salesByAsin || [];
      }
  
      console.log(`🔹 Extracted salesAggregate count: ${salesAggregate.length}`);
      console.log(`🔹 Extracted salesByAsin count: ${salesByAsin.length}`);
  
      // Fetch existing report or create a new one
      let savedReport = await this.salesReportRepository.findOne({
        where: {
          reportType: 'Type',
          reportPeriod: 'Period',
        },
      });
  
      if (!savedReport) {
        const report = new AmazonSalesReport();
        report.reportType = 'Type';
        report.reportPeriod = 'Period';
        report.sellingProgram = 'Program';
        report.distributorView = 'View';
        report.lastUpdatedDate = new Date();
        report.dataStartTime = new Date();
        report.dataEndTime = new Date();
        report.marketplaceIds = ['US'];
  
        savedReport = await this.salesReportRepository.save(report);
        console.log('✅ Saved AmazonSalesReport:', savedReport);
      } else {
        console.log('⚠️ Report already exists. Skipping creation of duplicate report.');
      }
  
      // Process Sales Aggregate Data (with retry logic and duplication check)
      if (salesAggregate.length > 0) {
        const aggregatesToInsert = [];
        const existingAggregates = await this.salesAggregateRepository.find({
          where: {
            report: savedReport,
            startDate: In(salesAggregate.map(a => a.startDate)),
            endDate: In(salesAggregate.map(a => a.endDate)),
          },
        });
  
        const existingAggregateIds = existingAggregates.map(a => `${a.startDate}-${a.endDate}`);
  
        for (const aggregate of salesAggregate) {
          if (existingAggregateIds.includes(`${aggregate.startDate}-${aggregate.endDate}`)) {
            console.log('⚠️ Skipping duplicate Sales Aggregate:', aggregate);
            continue;
          }
  
          const aggregateRecord = new AmazonSalesAggregate();
          aggregateRecord.report = savedReport;
          aggregateRecord.startDate = aggregate.startDate || null;
          aggregateRecord.endDate = aggregate.endDate || null;
  
          // Default missing numerical fields to 0 and set currency to 'USD'
          aggregateRecord.customerReturns = aggregate.customerReturns ?? 0;
          aggregateRecord.orderedRevenueAmount = aggregate.orderedRevenue?.amount ?? 0;
          aggregateRecord.orderedRevenueCurrency = 'USD';
          aggregateRecord.orderedUnits = aggregate.orderedUnits ?? 0;
          aggregateRecord.shippedCogsAmount = aggregate.shippedCogs?.amount ?? 0;
          aggregateRecord.shippedCogsCurrency = 'USD';
          aggregateRecord.shippedRevenueAmount = aggregate.shippedRevenue?.amount ?? 0;
          aggregateRecord.shippedRevenueCurrency = 'USD';
          aggregateRecord.shippedUnits = aggregate.shippedUnits ?? 0;
  
          aggregatesToInsert.push(aggregateRecord);
        }
  
        if (aggregatesToInsert.length > 0) {
          await this.salesAggregateRepository.save(aggregatesToInsert);
          console.log(`✅ Inserted ${aggregatesToInsert.length} Sales Aggregates.`);
        } else {
          console.warn('⚠️ No new Sales Aggregates to insert.');
        }
      } else {
        console.warn('⚠️ No sales aggregate data found.');
      }
  
      // Process Sales by ASIN Data (with enhanced duplication check)
      if (salesByAsin.length > 0) {
        const asinToInsert = [];
  
        // Fetch existing records for the given report, ASINs, and start dates
        const existingAsinRecords = await this.salesByAsinRepository.find({
          where: {
            report: savedReport,
            asin: In(salesByAsin.map(a => a.asin)),
            startDate: In(salesByAsin.map(a => a.startDate)),
          },
        });
  
        const existingAsinRecordSet = new Set(existingAsinRecords.map(record => `${record.asin}-${record.startDate.toString()}`));
  
        for (const asinData of salesByAsin) {
          if (existingAsinRecordSet.has(`${asinData.asin}-${new Date(asinData.startDate).toISOString()}`)) {
            console.warn(`⚠️ Skipping duplicate Sales by ASIN data (ASIN: ${asinData.asin}, Date: ${asinData.startDate})`);
            continue;
          }
  
          const asinRecord = new AmazonSalesByAsin();
          asinRecord.report = savedReport;
          asinRecord.asin = asinData.asin;
          asinRecord.startDate = asinData.startDate;
          asinRecord.endDate = asinData.endDate;
          asinRecord.orderedRevenueAmount = asinData.orderedRevenue?.amount ?? 0;
          asinRecord.orderedRevenueCurrency = 'USD';
          asinRecord.shippedRevenueAmount = asinData.shippedRevenue?.amount ?? 0;
          asinRecord.shippedRevenueCurrency = 'USD';
          asinRecord.orderedUnits = asinData.orderedUnits ?? 0;
          asinRecord.shippedUnits = asinData.shippedUnits ?? 0;
          asinRecord.customerReturns = asinData.customerReturns ?? 0;
  
          asinToInsert.push(asinRecord);
        }
  
        if (asinToInsert.length > 0) {
          await this.salesByAsinRepository.save(asinToInsert);
          console.log(`✅ Inserted ${asinToInsert.length} Sales by ASIN records.`);
        } else {
          console.warn('⚠️ No new Sales by ASIN data to insert.');
        }
      } else {
        console.warn('⚠️ No sales by ASIN data found.');
      }
    } catch (error) {
      console.error('Error processing sales data:', error.message || error);
      throw new Error('Failed to process vendor sales data');
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