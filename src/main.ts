import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ReportsService } from './reports/reports.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const reportsService = app.get(ReportsService);

  const now = new Date();
  const currentYear = now.getFullYear();
  const startDate = new Date(Date.UTC(currentYear, 0, 1, 0, 0, 0, 0));
  const endDate = new Date(Date.UTC(currentYear, 0, 31, 23, 59, 59, 999));

  console.log('Start Date:', startDate.toISOString());
  console.log('End Date:', endDate.toISOString());

  const reportTypes = [
    'GET_VENDOR_SALES_REPORT',
    'GET_VENDOR_INVENTORY_REPORT',
    'GET_VENDOR_FORECASTING_REPORT',
  ];

  for (const reportType of reportTypes) {
    await reportsService.fetchAndStoreReports(reportType, startDate, endDate);
  }

  console.log('All reports processed.');
  await app.listen(3000);
}

bootstrap();
