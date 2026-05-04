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

  // @Cron('0 0 * * 5', { timeZone: 'America/New_York' }) // Friday midnight ET — DISABLED
  async scheduledInventoryFetch() {
    // 1. Cleanup any historically failed reports first (chunked)
    await this.inventoryService.retryUntilAllComplete();

    // 2. Start the new weekly fetch
    const now = new Date();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() - 6);
    endDate.setHours(23, 59, 59, 999);

    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 6);
    startDate.setHours(0, 0, 0, 0);

    this.logger.log(
      `Starting weekly inventory fetch | window: ${startDate.toISOString()} to ${endDate.toISOString()}`,
    );

    try {
      await this.inventoryService.fetchAndStoreReports(startDate, endDate);
      this.logger.log('Weekly inventory fetch finished.');
    } catch (error) {
      this.logger.error(`Weekly inventory fetch fatal error: ${error.message}`);
    }
  }
}
