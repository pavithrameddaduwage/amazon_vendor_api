import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ReportsService } from './reports.service';

@Injectable()
export class ReportsScheduler {
  constructor(private readonly reportsService: ReportsService) {}

  @Cron('0 0 * * 3')   
  async fetchReports() {
    try {
      console.log('Starting scheduled report fetching...');

      const reportTypes = [
        'GET_VENDOR_SALES_REPORT',
        // 'GET_VENDOR_FORECAST_REPORT',
        // 'GET_VENDOR_INVENTORY_REPORT',
      ];

      for (const reportType of reportTypes) {
        await this.reportsService.fetchAndStoreReports(reportType, null, null);  
      }

      console.log('Scheduled report fetching completed.');
    } catch (error) {
      console.error('Error in scheduled report fetching:', error.message);
    }
  }
}
