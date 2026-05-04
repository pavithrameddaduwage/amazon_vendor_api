import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SalesService } from './sales.service';

@Injectable()
export class SalesScheduler implements OnModuleInit {
  private readonly logger = new Logger(SalesScheduler.name);

  constructor(private readonly salesService: SalesService) {}

  onModuleInit() {
    this.logger.log('Initialized — triggering initial fetch for last 4 weeks in background...');
    this.fetchLastNWeeks(4).catch(err => 
      this.logger.error(`Initial fetch failed: ${err.message}`)
    );
  }
  private async fetchLastNWeeks(n: number): Promise<void> {
    // 1. Cleanup any historically failed reports first (synchronously for safety)
    await this.salesService.retryUntilAllComplete();

    // 2. Build weekly windows
    const now = new Date();
    const windows: { startDate: Date; endDate: Date }[] = [];

    for (let i = 1; i <= n; i++) {
      const endDate = new Date(now);
      endDate.setDate(endDate.getDate() - (i - 1) * 7 - 1);
      endDate.setHours(23, 59, 59, 999);

      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 6);
      startDate.setHours(0, 0, 0, 0);

      windows.push({ startDate, endDate });
    }

    this.logger.log(`Fetching ${n} weekly windows with concurrency control...`);

    // 3. Process windows in parallel but limited concurrency to avoid 429 suicide
    const CONCURRENCY = 2;
    const chunks: { startDate: Date; endDate: Date }[][] = [];
    for (let i = 0; i < windows.length; i += CONCURRENCY) {
      chunks.push(windows.slice(i, i + CONCURRENCY));
    }

    for (const chunk of chunks) {
      this.logger.log(`Processing batch of ${chunk.length} windows...`);
      await Promise.allSettled(
        chunk.map(async (window) => {
          try {
            // Small jitter to prevent simultaneous requests
            await new Promise(resolve => setTimeout(resolve, Math.random() * 5000));
            await this.salesService.fetchAndStoreReports(window.startDate, window.endDate);
          } catch (error) {
            this.logger.error(`Window fetch failed: ${error.message}`);
          }
        })
      );
      // Optional: wait between batches
      await new Promise(resolve => setTimeout(resolve, 10_000));
    }

    this.logger.log('All weekly windows processing finished.');
  }

  @Cron('0 0 * * 4', { timeZone: 'America/New_York' }) // Thursday midnight ET
  async scheduledSalesFetch() {
    await this.fetchLastNWeeks(1);
  }
}
