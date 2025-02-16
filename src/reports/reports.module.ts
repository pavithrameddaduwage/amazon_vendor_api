import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { AuthModule } from 'src/auth.module';

import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
 
import { AmazonSalesAggregate } from './entities/amazon_sales_aggregate.entity';
import { AmazonSalesByAsin } from './entities/amazon_sales_by_asin.entity';
import { AmazonForecastByAsin } from './entities/amazon_forecasting_by_asin.entity';
import { AmazonForecastingReport } from './entities/amazon_forecasting_report.entity';
import { AmazonInventoryByAsin } from './entities/amazon_inventory_by_asin.entity';
import { AmazonInventoryReport } from './entities/amazon_inventory_report.entity';
import { AmazonVendorInventory } from './entities/amazon_vendor_inventory.entity';
import { AmazonForecastByAsinRepository } from './entities/repsitory/amazon-forecast-by-asin.repository';
import { AmazonForecastingReportRepository } from './entities/repsitory/amazon-forecasting-report.repository';
import { AmazonInventoryByAsinRepository } from './entities/repsitory/amazon-inventory-by-asin.repository';
import { AmazonInventoryReportRepository } from './entities/repsitory/amazon-inventory-report.repository';
import { AmazonSalesAggregateRepository } from './entities/repsitory/amazon-sales-aggregate.repository';
import { AmazonSalesByAsinRepository } from './entities/repsitory/amazon-sales-by-asin.repository';
import { AmazonSalesReportRepository } from './entities/repsitory/amazon-sales-report.repository';
import { AmazonVendorInventoryRepository } from './entities/repsitory/amazon-vendor-inventory.repository';
import { AmazonSalesReport } from './entities/amazon_sales_report.entity';

 

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AmazonSalesReport,
      AmazonSalesAggregate,
      AmazonSalesByAsin,
      AmazonForecastByAsin,
      AmazonForecastingReport,
      AmazonInventoryByAsin,
      AmazonInventoryReport,
      AmazonVendorInventory,
      AmazonSalesReportRepository,    
      AmazonSalesByAsinRepository,
      AmazonSalesAggregateRepository,
      AmazonForecastByAsinRepository,
      AmazonVendorInventoryRepository,
      AmazonInventoryReportRepository,
      AmazonForecastingReportRepository,
      AmazonInventoryByAsinRepository,
    ]),
    HttpModule,
    AuthModule,
  ],
  providers: [ReportsService],
  controllers: [ReportsController],
})
export class ReportsModule {}
