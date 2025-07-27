//reports controller

import { Controller, Get, Query, HttpException, HttpStatus } from '@nestjs/common';
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
      const now = new Date();
      const startDate = startDateParam ? new Date(startDateParam) : new Date(now.getFullYear(), 0, 1);
      const endDate = endDateParam ? new Date(endDateParam) : now;

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new HttpException('Invalid date format provided.', HttpStatus.BAD_REQUEST);
      }

      if (startDate > endDate) {
        throw new HttpException('Start date must be before or equal to end date.', HttpStatus.BAD_REQUEST);
      }

      console.log(`[ReportsController] Start Date: ${startDate.toISOString()}`);
      console.log(`[ReportsController] End Date: ${endDate.toISOString()}`);

      const reportTypes = [
        'GET_VENDOR_SALES_REPORT',
        'GET_VENDOR_INVENTORY_REPORT',
      ];

      for (const reportType of reportTypes) {
        console.log(`[ReportsController] Processing report: ${reportType}`);
        await this.reportsService.fetchAndStoreReports(reportType, startDate, endDate);
      }

      console.log('[ReportsController] Processing forecast report...');
      await this.forecastService.fetchAndStoreForecasts(startDate, endDate);

      return {
        message: 'Reports processed successfully.',
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      };
    } catch (error) {
      console.error('[ReportsController] Error processing reports:', error.message || error);
      throw new HttpException(
        {
          message: 'Error processing reports',
          error: error.message || 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
