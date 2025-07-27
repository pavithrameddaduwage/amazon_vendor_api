//reports module

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { AuthModule } from 'src/auth.module'; 
import { ReportsController } from './reports.controller'; 
import { ReportsService } from './reports.service';
import { SalesReportService } from './sales-report.service';
import { InventoryReportService } from './inventory-report.service';
import { ForecastService } from './forecast.service';
import { AmazonSalesAggregate } from './entities/amazon_sales_aggregate.entity';


import { AmazonSalesByAsin } from './entities/amazon_sales_by_asin.entity';
import { AmazonForecastByAsin } from './entities/amazon_forecasting_by_asin.entity';
import { AmazonForecastingReport } from './entities/amazon_forecasting_report.entity';
import { AmazonInventoryByAsin } from './entities/amazon_inventory_by_asin.entity';
import { AmazonInventoryReport } from './entities/amazon_inventory_report.entity';
import { AmazonVendorInventory } from './entities/amazon_vendor_inventory.entity';
import { AmazonSalesReport } from './entities/amazon_sales_report.entity';
import { ReportStatusEntity } from './entities/ReportStatusEntity'; 
import { AmazonSalesAggregateRepository } from './entities/repsitory/amazon-sales-aggregate.repository';
import { AmazonSalesByAsinRepository } from './entities/repsitory/amazon-sales-by-asin.repository';
import { ReportStatusRepository } from './entities/repsitory/ReportStatusRepository';
import { ReportsScheduler } from './reports.scheduler';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AmazonSalesAggregate,
      AmazonSalesByAsin,
      AmazonSalesReport,
      AmazonForecastByAsin,    
      AmazonForecastingReport,  
      AmazonInventoryByAsin,   
      AmazonInventoryReport,    
      AmazonVendorInventory,    
      ReportStatusEntity,
    ]),
    HttpModule,
    AuthModule,
  ],
  providers: [
    ReportsService,
    ReportsScheduler,
    SalesReportService,
    InventoryReportService,  
    ForecastService, 
    AmazonSalesAggregateRepository,
    AmazonSalesByAsinRepository,
    ReportStatusRepository,
  ],
  controllers: [ReportsController],
  exports: [
    ReportsService,
    SalesReportService,
    InventoryReportService,  
    ForecastService, 
    AmazonSalesAggregateRepository,
    AmazonSalesByAsinRepository,
    ReportStatusRepository,
  ],
})
export class ReportsModule {}
