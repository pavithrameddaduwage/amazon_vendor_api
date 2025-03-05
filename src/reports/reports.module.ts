import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { AuthModule } from 'src/auth.module';

import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { SalesReportService } from './sales-report.service';

// Entities
import { AmazonSalesAggregate } from './entities/amazon_sales_aggregate.entity';
import { AmazonSalesByAsin } from './entities/amazon_sales_by_asin.entity';
import { AmazonForecastByAsin } from './entities/amazon_forecasting_by_asin.entity';
import { AmazonForecastingReport } from './entities/amazon_forecasting_report.entity';
import { AmazonInventoryByAsin } from './entities/amazon_inventory_by_asin.entity';
import { AmazonInventoryReport } from './entities/amazon_inventory_report.entity';
import { AmazonVendorInventory } from './entities/amazon_vendor_inventory.entity';
import { AmazonSalesReport } from './entities/amazon_sales_report.entity';
import { ReportStatusEntity } from './entities/ReportStatusEntity';

// Repositories
import { AmazonSalesAggregateRepository } from './entities/repsitory/amazon-sales-aggregate.repository';
import { AmazonSalesByAsinRepository } from './entities/repsitory/amazon-sales-by-asin.repository';
import { ReportStatusRepository } from './entities/repsitory/ReportStatusRepository';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AmazonSalesAggregate,
      AmazonSalesByAsin,
      AmazonSalesReport,
      ReportStatusEntity,
    ]),
    HttpModule, 
    AuthModule,
  ],
  providers: [
    ReportsService,
    SalesReportService,
    AmazonSalesAggregateRepository,
    AmazonSalesByAsinRepository,
    ReportStatusRepository,
  ],
  controllers: [ReportsController],
  exports: [
    SalesReportService,
    ReportsService,
    AmazonSalesAggregateRepository,
    AmazonSalesByAsinRepository,
    ReportStatusRepository,
  ],
})
export class ReportsModule {}
