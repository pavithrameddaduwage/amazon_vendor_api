import { Injectable } from "@nestjs/common";
import { SalesReportService } from "./sales-report.service";
import { InventoryReportService } from "./inventory-report.service";
import { ForecastService } from "./forecast.service";  

@Injectable()
export class ReportsService {
  constructor(
    private readonly salesReportService: SalesReportService,
    private readonly inventoryReportService: InventoryReportService,
    private readonly forecastReportService: ForecastService   
  ) {}

  public async fetchAndStoreReports(reportType: string, startDate: Date, endDate: Date) {
    try {
      await this.salesReportService.fetchAndStoreReports(startDate, endDate);
    } catch (error) {
      console.error(`Error processing Sales Report: ${error.message}`);
    }

    try {
      await this.inventoryReportService.fetchAndStoreReports(reportType, startDate, endDate);
    } catch (error) {
      console.error(`Error processing Inventory Report: ${error.message}`);
    }

    try {
      await this.forecastReportService.fetchAndStoreForecasts(startDate, endDate);
    } catch (error) {
      console.error(`Error processing Forecast Report: ${error.message}`);
    }
  }

  public async fetchReports(reportType: string, startDate: Date, endDate: Date) {
    return {
      salesReport: await this.salesReportService.fetchAndStoreReports(startDate, endDate),
      inventoryReport: await this.inventoryReportService.fetchAndStoreReports(reportType, startDate, endDate),
      forecastReport: await this.forecastReportService.fetchAndStoreForecasts(startDate, endDate),
    };
  }
}
