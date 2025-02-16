import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ReportsService } from './reports.service';

@Injectable()
export class ReportsScheduler {
  constructor(private readonly reportsService: ReportsService) {}

   
  @Cron('0 0 * * 3')  
  async fetchReports() {
    try {
      const reportTypes = [
        'GET_VENDOR_SALES_REPORT',
        'GET_VENDOR_FORECAST_REPORT',
        'GET_VENDOR_INVENTORY_REPORT',
      ];

      const currentDate = new Date();
      
       
      const startDate = new Date(currentDate.setMonth(currentDate.getMonth() - 1));
      const endDate = new Date();  

      console.log('Fetching reports from:', startDate);
      console.log('To:', endDate);

   
      for (const reportType of reportTypes) {
        try {
          console.log(`Fetching ${reportType}...`);
          await this.reportsService.fetchAndStoreReports(reportType, startDate, endDate);
          console.log(`${reportType} fetched and stored successfully.`);
        } catch (reportError) {
          console.error(`Error fetching ${reportType}:`, reportError.message);
        }
      }
    } catch (error) {
      console.error('Error during the report fetching process:', error.message);
    }
  }
}
