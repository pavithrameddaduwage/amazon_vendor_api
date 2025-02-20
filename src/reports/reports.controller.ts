import { Controller, Get, Query } from '@nestjs/common';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('fetch/all')
  async fetchAndProcessAllReports(
    @Query('startDate') startDateParam: string,
    @Query('endDate') endDateParam: string,
  ) {
    try {
      // Set default start date to December 29, 2024, if not provided
      const startDate = startDateParam
        ? new Date(startDateParam)
        : new Date('2024-12-29T00:00:00Z');

      // Default end date to today if not provided
      const endDate = endDateParam ? new Date(endDateParam) : new Date();

      // Ensure the dates are valid
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new Error('Invalid date format provided.');
      }

      console.log('Start Date:', startDate);
      console.log('End Date:', endDate);

      const successfullyFetchedReports = new Set();

      const fetchReportWithRetry = async (reportType: string) => {
        try {
          console.log(`Fetching report: ${reportType}`);
          await this.reportsService.fetchAndStoreReports(reportType, startDate, endDate);
          successfullyFetchedReports.add(reportType);
          console.log(`${reportType} fetch process finished.`);
        } catch (error) {
          console.error(`Error fetching and storing ${reportType}:`, error.message);
        }
      };

      const reportTypes = [
        'GET_VENDOR_INVENTORY_REPORT',
        'GET_VENDOR_SALES_REPORT',
        'GET_VENDOR_FORECAST_REPORT',
      ];

      for (const reportType of reportTypes) {
        if (!successfullyFetchedReports.has(reportType)) {
          await fetchReportWithRetry(reportType);
        }
      }

      for (const reportType of reportTypes) {
        if (!successfullyFetchedReports.has(reportType)) {
          console.log(`Retrying report: ${reportType}`);
          await fetchReportWithRetry(reportType);
        }
      }

      return {
        message: `Processing all reports from ${startDate.toISOString()} to ${endDate.toISOString()}`,
      };
    } catch (error) {
      console.error('Error processing reports:', error);
      return { message: 'Error processing reports', error: error.message };
    }
  }
}
