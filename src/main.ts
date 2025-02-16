import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ReportsService } from './reports/reports.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const reportsService = app.get(ReportsService);

  // List of report types in the desired order (inventory, sales, and forecasting)
  const reportTypes = [
    'GET_VENDOR_INVENTORY_REPORT',
    'GET_VENDOR_SALES_REPORT',
    'GET_VENDOR_FORECASTING_REPORT',
  ];

  console.log('Starting report fetch process...');

  // Fixed start date (January 1, 2025) for all reports
  const startDate = new Date('2025-01-01T00:00:00Z'); // UTC midnight on January 1, 2025

  // Set end date to today
  const endDate = new Date();
  endDate.setHours(23, 59, 59, 999);  // End of the current day

  console.log('Start Date:', startDate);
  console.log('End Date:', endDate);

  // Keep track of successfully fetched reports
  const successfullyFetchedReports = new Set();

  // Helper function to try fetching a report and retry on failure
  const fetchReportWithRetry = async (reportType: string) => {
    try {
      console.log(`Fetching report: ${reportType}`);
      // Ensure no duplicate data is stored
      await reportsService.fetchAndStoreReports(reportType, startDate, endDate);
      successfullyFetchedReports.add(reportType); // Mark as successfully fetched
      console.log(`${reportType} fetch process finished.`);
    } catch (error) {
      console.error(`Error fetching and storing ${reportType}:`, error.message);
    }
  };

  // First, attempt to fetch the reports in the desired order
  for (const reportType of reportTypes) {
    // Skip reports that have already been fetched successfully
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

  console.log('All reports have been processed.');

  await app.listen(3000);
}
bootstrap();
