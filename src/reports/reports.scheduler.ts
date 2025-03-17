import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ReportsService } from './reports.service';

@Injectable()
export class ReportsScheduler {
  constructor(private readonly reportsService: ReportsService) {}

  @Cron('0 0 * * 3')  
  async fetchSalesReports() {
    try {
      console.log('Starting scheduled sales report fetching...');

      const startDate = new Date(new Date().getFullYear(), 0, 1);  
      const endDate = new Date();  

      await this.reportsService.fetchAndStoreReports('GET_VENDOR_SALES_REPORT', startDate, endDate);

      console.log('Scheduled sales report fetching completed.');
    } catch (error) {
      console.error('Error in scheduled sales report fetching:', error.message);
    }
  }

  @Cron('0 0 * * 0')  
  async fetchInventoryReports() {
    try {
      console.log('Starting scheduled inventory report fetching...');

      const startDate = new Date(new Date().getFullYear(), 0, 1);  
      const endDate = new Date();  

      await this.reportsService.fetchAndStoreReports('GET_VENDOR_INVENTORY_REPORT', startDate, endDate);

      console.log('Scheduled inventory report fetching completed.');
    } catch (error) {
      console.error('Error in scheduled inventory report fetching:', error.message);
    }
  }

  @Cron('0 0 * * 5') 
  async fetchForecastReports() {
    try {
      console.log('Starting scheduled forecast report fetching...');

      const startDate = new Date(new Date().getFullYear(), 0, 1);  
      const endDate = new Date();  

      await this.reportsService.fetchAndStoreReports('GET_FORECAST_REPORT', startDate, endDate);

      console.log('Scheduled forecast report fetching completed.');
    } catch (error) {
      console.error('Error in scheduled forecast report fetching:', error.message);
    }
  }
}
