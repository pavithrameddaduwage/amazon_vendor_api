import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ReportsService } from './reports/reports.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const reportsService = app.get(ReportsService);
  const startDate = new Date(2024, 11, 29);   
  const endDate = new Date(2025, 0, 31);   
  console.log('Start Date:', startDate.toDateString());
  console.log('End Date:', endDate.toDateString());
  
  const reportTypes = [
    'GET_VENDOR_SALES_REPORT',
    'GET_VENDOR_INVENTORY_REPORT',
    'GET_VENDOR_FORECASTING_REPORT',
  ];

  for (const reportType of reportTypes) {
    try {
      console.log(`Fetching report: ${reportType}`);
      await reportsService.fetchAndStoreReports(reportType, startDate, endDate);
      console.log(`Successfully processed: ${reportType}`);
    } catch (error) {
      console.error(`Error processing ${reportType}:`, error);
    }
  }

  console.log('All reports processed.');
  await app.listen(3000);
}

bootstrap();
