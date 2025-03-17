import { Controller, Get, Query } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ForecastService } from './forecast.service';

@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly forecastService: ForecastService
  ) {}

  @Get('fetch/all')
  async fetchAndProcessAllReports(
    @Query('startDate') startDateParam?: string,
    @Query('endDate') endDateParam?: string,
  ) {
    try {
      const startDate = startDateParam ? new Date(startDateParam) : new Date(new Date().getFullYear(), 0, 1);
      const endDate = endDateParam ? new Date(endDateParam) : new Date();

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new Error('Invalid date format provided.');
      }

      console.log('Start Date:', startDate.toISOString());
      console.log('End Date:', endDate.toISOString());

      const reportTypes = [
        'GET_VENDOR_SALES_REPORT',
        'GET_VENDOR_INVENTORY_REPORT',
      ];

      for (const reportType of reportTypes) {
        await this.reportsService.fetchAndStoreReports(reportType, startDate, endDate);
      }

    
      await this.forecastService.fetchAndStoreForecasts(startDate, endDate);

      return { message: `Processing all reports from ${startDate.toISOString()} to ${endDate.toISOString()}` };
    } catch (error) {
      console.error('Error processing reports:', error);
      return { message: 'Error processing reports', error: error.message };
    }
  }
}
