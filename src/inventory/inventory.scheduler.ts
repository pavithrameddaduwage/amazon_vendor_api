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
    // 1. Cleanup any historically failed reports first
    await this.inventoryService.retryUntilAllComplete();

    // 2. Start the new weekly fetch
    // Runs on Friday — previous Saturday is always 6 days back
    const now = new Date();

    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() - 6); // Friday - 6 = last Saturday
    endDate.setHours(23, 59, 59, 999);

    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 6); // Saturday - 6 = last Sunday
    startDate.setHours(0, 0, 0, 0);

    this.logger.log(
      `Starting weekly fetch | window: ${startDate.toISOString()} to ${endDate.toISOString()}`,
    );

    try {
      await this.inventoryService.fetchAndStoreReports(startDate, endDate);
      this.logger.log('Weekly fetch completed successfully.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Weekly fetch fatal error: ${message}`);
    }
  }
}
