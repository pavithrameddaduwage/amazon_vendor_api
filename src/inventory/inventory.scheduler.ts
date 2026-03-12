import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InventoryService } from './inventory.service';

@Injectable()
export class InventoryScheduler implements OnModuleInit {
  constructor(private readonly inventoryService: InventoryService) {}

  onModuleInit() {
    console.log('InventoryScheduler initialized');
  }

  @Cron('0 0 * * 0', { timeZone: 'America/New_York' })
  async scheduledInventoryFetch() {
    console.log('[InventoryScheduler] Starting weekly inventory report fetch...');

    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 14);
    startDate.setHours(0, 0, 0, 0);

    console.log(`[InventoryScheduler] Window: ${startDate.toISOString()} to ${endDate.toISOString()}`);

    try {
      await this.inventoryService.fetchAndStoreReports(startDate, endDate);
      console.log('[InventoryScheduler] Completed successfully.');
    } catch (error) {
      console.error('[InventoryScheduler] Fatal error:', error.message);
    }
  }
}
