import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SalesService } from './sales.service';

@Injectable()
export class SalesScheduler implements OnModuleInit {
  private readonly logger = new Logger(SalesScheduler.name);

  constructor(private readonly salesService: SalesService) {}

  async onModuleInit() {
    this.logger.log('Initialized — triggering initial fetch for last 4 weeks...');
    await this.fetchLastNWeeks(4);
  }
  private async fetchLastNWeeks(n: number): Promise<void> {
    // 1. Cleanup any historically failed reports first
    await this.salesService.retryUntilAllComplete();

    // 2. Build weekly windows going back n weeks from today
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

    this.logger.log(`Fetching ${n} weekly windows...`);

    // 3. Fetch each window sequentially to avoid hammering the API
    for (const { startDate, endDate } of windows) {
      this.logger.log(
        `Starting fetch | window: ${startDate.toISOString()} to ${endDate.toISOString()}`,
      );
      try {
        await this.salesService.fetchAndStoreReports(startDate, endDate);
        this.logger.log(`Completed window: ${startDate.toISOString()} to ${endDate.toISOString()}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Window fetch failed: ${message}`);
      }
    }

    this.logger.log('All weekly windows processed.');
  }

  @Cron('0 0 * * 4', { timeZone: 'America/New_York' }) // Thursday midnight ET
  async scheduledSalesFetch() {
    await this.fetchLastNWeeks(1);
  }
}
