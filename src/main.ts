import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ReportsService } from './reports/reports.service';
import { config } from 'dotenv';

config();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const reportsService = app.get(ReportsService);

  const currentDate = new Date();
  const startDate = new Date(currentDate.getFullYear(), 2, 1, 0, 0, 0);  
  const endDate = currentDate;

  console.log('Start Date:', startDate.toISOString());
  console.log('End Date:', endDate.toISOString());

  const reportTypes = [
    'GET_VENDOR_SALES_REPORT',
    'GET_VENDOR_INVENTORY_REPORT',
    'GET_VENDOR_FORECAST_REPORT',   
  ];

  for (const reportType of reportTypes) {
    try {
      console.log(`Fetching report: ${reportType}`);
      await reportsService.fetchAndStoreReports(reportType, startDate, endDate);
      console.log(`Successfully processed: ${reportType}`);
    } catch (error) {
      console.error(`Error processing ${reportType}:`, error.message);
    }
  }

  console.log('All reports processed.');
  await app.listen(3000);
}

bootstrap();
