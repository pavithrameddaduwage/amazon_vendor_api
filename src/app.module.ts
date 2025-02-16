import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';  // Import ConfigModule
import { ReportsModule } from './reports/reports.module';
import { AuthModule } from './auth.module';
import { AmazonForecastingReport } from './reports/entities/amazon_forecasting_report.entity';
import { AmazonForecastByAsin } from './reports/entities/amazon_forecasting_by_asin.entity';
import { AmazonInventoryByAsin } from './reports/entities/amazon_inventory_by_asin.entity';
import { AmazonInventoryReport } from './reports/entities/amazon_inventory_report.entity';
import { AmazonSalesAggregate } from './reports/entities/amazon_sales_aggregate.entity';
import { AmazonSalesByAsin } from './reports/entities/amazon_sales_by_asin.entity';
 
import { AmazonVendorInventory } from './reports/entities/amazon_vendor_inventory.entity';
import { AmazonSalesReport } from './reports/entities/amazon_sales_report.entity';

@Module({
  imports: [
    // Import ConfigModule and load the .env file
    ConfigModule.forRoot({
      isGlobal: true, // Make the configuration globally available
    }),

    // TypeOrmModule setup with database configurations
    TypeOrmModule.forRoot({
      type: 'postgres',  // Database type
      host: process.env.DATABASE_HOST,  // Use the values from .env
      port: +process.env.DATABASE_PORT, // Ensure the port is a number
      username: process.env.DATABASE_USER,
      password: process.env.DATABASE_PASSWORD,
      database: process.env.DATABASE_NAME,
      entities: [
        AmazonForecastByAsin,
        AmazonForecastingReport,
        AmazonInventoryByAsin,
        AmazonInventoryReport,
        AmazonSalesReport,
        AmazonSalesByAsin,
        AmazonSalesAggregate,
        AmazonVendorInventory,
      ],
      synchronize: true,  // Set to false in production
    }),

    // Importing your custom modules
    ReportsModule,
    AuthModule,
  ],
})
export class AppModule {}
