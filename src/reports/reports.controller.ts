import { Controller, Get, Query } from '@nestjs/common';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('fetch/all')
  async fetchAndProcessAllReports(
    @Query('startDate') startDateParam?: string,
    @Query('endDate') endDateParam?: string,
  ) {
    try {
      if (!startDateParam || !endDateParam) {
        throw new Error('Start and end dates are required.');
      }

      const startDate = new Date(startDateParam);
      const endDate = new Date(endDateParam);
      
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new Error('Invalid date format provided.');
      }

      console.log('Start Date:', startDate);
      console.log('End Date:', endDate);

      const reportTypes = [
        'GET_VENDOR_SALES_REPORT',
        'GET_VENDOR_INVENTORY_REPORT',
        'GET_VENDOR_FORECAST_REPORT',
      ];

      for (const reportType of reportTypes) {
        await this.reportsService.fetchAndStoreReports(reportType, startDate, endDate);
      }

      return { message: `Processing all reports from ${startDate.toISOString()} to ${endDate.toISOString()}` };
    } catch (error) {
      console.error('Error processing reports:', error);
      return { message: 'Error processing reports', error: error.message };
    }
  }
}
