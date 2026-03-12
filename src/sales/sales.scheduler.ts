import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SalesService } from './sales.service';

@Injectable()
export class SalesScheduler implements OnModuleInit {
  constructor(private readonly salesService: SalesService) {}

  onModuleInit() {
    console.log('SalesScheduler initialized — triggering initial fetch...');

    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 14);
    startDate.setHours(0, 0, 0, 0);

    this.salesService.fetchAndStoreReports(startDate, endDate).catch(err => {
      console.error('Initial sales fetch failed:', err.message);
    });
  }

  @Cron('0 0 * * 2', { timeZone: 'America/New_York' })
  async scheduledSalesFetch() {
    console.log('[SalesScheduler] Starting weekly sales report fetch...');

    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 14);
    startDate.setHours(0, 0, 0, 0);

    console.log(`[SalesScheduler] Window: ${startDate.toISOString()} to ${endDate.toISOString()}`);

    try {
      await this.salesService.fetchAndStoreReports(startDate, endDate);
      console.log('[SalesScheduler] Completed successfully.');
    } catch (error) {
      console.error('[SalesScheduler] Fatal error:', error.message);
    }
  }
}
