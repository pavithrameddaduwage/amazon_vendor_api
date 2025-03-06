import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ReportsService } from './reports/reports.service';
import { config } from 'dotenv';
config();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const reportsService = app.get(ReportsService);

  const today = new Date();
  const startDate = new Date(today.getFullYear() - 1, 11, 29); 
  const endDate = new Date(today);  

  console.log('Start Date:', startDate.toISOString());
  console.log('End Date:', endDate.toISOString());

  const reportTypes = [
    'GET_VENDOR_SALES_REPORT',
    // 'GET_VENDOR_INVENTORY_REPORT',
    // 'GET_VENDOR_FORECASTING_REPORT',
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
  // await app.listen(4003);
}

bootstrap();
