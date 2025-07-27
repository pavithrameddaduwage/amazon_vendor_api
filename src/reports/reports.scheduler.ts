
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ReportsService } from './reports.service';

const CRON_SALES = '0 0 * * 3';       
const CRON_INVENTORY = '0 0 * * 0';   
const CRON_FORECAST = '0 0 * * 5';    

// const CRON_SALES = '*/1 * * * *';      
// const CRON_INVENTORY = '*/1 * * * *';
// const CRON_FORECAST = '*/1 * * * *';

@Injectable()
export class ReportsScheduler implements OnModuleInit {
  constructor(private readonly reportsService: ReportsService) {}

  onModuleInit() {
    console.log('ReportsScheduler initialized — cron jobs registered.');
  }

  @Cron(CRON_SALES)
  async fetchSalesReports() {
    await this.handleScheduledReport('GET_VENDOR_SALES_REPORT', 'sales');
  }

  @Cron(CRON_INVENTORY)
  async fetchInventoryReports() {
    await this.handleScheduledReport('GET_VENDOR_INVENTORY_REPORT', 'inventory');
  }

  @Cron(CRON_FORECAST)
  async fetchForecastReports() {
    await this.handleScheduledReport('GET_FORECAST_REPORT', 'forecast');
  }

  private async handleScheduledReport(reportType: string, label: string) {
    try {
      console.log(`Starting scheduled ${label} report fetching...`);

      const endDate = new Date(); 
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - 7);

      console.log(`Fetching ${label} reports from ${startDate.toISOString()} to ${endDate.toISOString()}`);

      await this.reportsService.fetchAndStoreReports(reportType, startDate, endDate);

      console.log(`Scheduled ${label} report fetching completed.`);
    } catch (error) {
      console.error(`Error in scheduled ${label} report fetching:`, error.message);
    }
  }
}
