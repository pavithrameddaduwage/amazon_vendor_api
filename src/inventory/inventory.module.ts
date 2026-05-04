import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { AuthModule } from '../auth/auth.module';
import { CommonModule } from '../common/common.module';
import { AmazonInventoryByAsin } from './entities/amazon_inventory_by_asin.entity';
import { ReportStatusEntity } from '../common/entities/report-status.entity';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { InventoryScheduler } from './inventory.scheduler';

@Module({
  imports: [
    TypeOrmModule.forFeature([AmazonInventoryByAsin, ReportStatusEntity]),
    HttpModule,
    AuthModule,
    CommonModule,
  ],
  providers: [InventoryService, InventoryScheduler],
  controllers: [InventoryController],
  exports: [InventoryService],
})
export class InventoryModule {}
