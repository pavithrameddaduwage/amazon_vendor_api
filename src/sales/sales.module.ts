import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { AuthModule } from '../auth/auth.module';
import { CommonModule } from '../common/common.module';
import { AmazonSalesAggregate } from './entities/amazon_sales_aggregate.entity';
import { AmazonSalesByAsin } from './entities/amazon_sales_by_asin.entity';
import { ReportStatusEntity } from '../common/entities/report-status.entity';
import { SalesService } from './sales.service';
import { SalesController } from './sales.controller';
import { SalesScheduler } from './sales.scheduler';

@Module({
  imports: [
    TypeOrmModule.forFeature([AmazonSalesAggregate, AmazonSalesByAsin, ReportStatusEntity]),
    HttpModule,
    AuthModule,
    CommonModule,
  ],
  providers: [SalesService, SalesScheduler],
  controllers: [SalesController],
  exports: [SalesService],
})
export class SalesModule {}
