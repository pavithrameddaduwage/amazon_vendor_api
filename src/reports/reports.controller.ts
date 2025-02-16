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
      // Parse dynamic start and end dates if provided, otherwise use defaults
      const currentDate = new Date();
      const startDate = startDateParam
        ? new Date(startDateParam)
        : new Date(currentDate.setMonth(currentDate.getMonth() - 1)); // Default: 1 month ago
      const endDate = endDateParam ? new Date(endDateParam) : new Date(); // Default: Today

      // Ensure the dates are correct
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new Error('Invalid date format provided.');
      }

      console.log('Start Date:', startDate);
      console.log('End Date:', endDate);

      // Keep track of successfully fetched reports to avoid re-fetching
      const successfullyFetchedReports = new Set();

      // Helper function to try fetching a report and retry on failure
      const fetchReportWithRetry = async (reportType: string) => {
        try {
          console.log(`Fetching report: ${reportType}`);
          // Ensure no duplicate data is stored
          await this.reportsService.fetchAndStoreReports(reportType, startDate, endDate);
          successfullyFetchedReports.add(reportType); // Mark as successfully fetched
          console.log(`${reportType} fetch process finished.`);
        } catch (error) {
          console.error(`Error fetching and storing ${reportType}:`, error.message);
        }
      };

      // Fetch reports in the correct order: Inventory -> Sales -> Forecast
      const reportTypes = [
        'GET_VENDOR_INVENTORY_REPORT',
        'GET_VENDOR_SALES_REPORT',
        'GET_VENDOR_FORECAST_REPORT',
      ];

      // First attempt to fetch the reports in order, skipping already processed ones
      for (const reportType of reportTypes) {
        if (!successfullyFetchedReports.has(reportType)) {
          await fetchReportWithRetry(reportType);
        }
      }

      // Retry any reports that failed
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
