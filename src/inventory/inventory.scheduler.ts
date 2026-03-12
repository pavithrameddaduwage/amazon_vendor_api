import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InventoryService } from './inventory.service';

@Injectable()
export class InventoryScheduler implements OnModuleInit {
  private readonly logger = new Logger(InventoryScheduler.name);

  constructor(private readonly inventoryService: InventoryService) {}

  onModuleInit() {
    this.logger.log('Initialized.');
  }

  @Cron('0 0 * * 0', { timeZone: 'America/New_York' })
  async scheduledInventoryFetch() {
    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 14);
    startDate.setHours(0, 0, 0, 0);

    this.logger.log(`Starting weekly fetch | window: ${startDate.toISOString()} to ${endDate.toISOString()}`);

    try {
      await this.inventoryService.fetchAndStoreReports(startDate, endDate);
      this.logger.log('Weekly fetch completed successfully.');
    } catch (error) {
      this.logger.error(`Weekly fetch fatal error: ${error.message}`);
    }
  }
}
