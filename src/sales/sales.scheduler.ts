import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SalesService } from './sales.service';

@Injectable()
export class SalesScheduler implements OnModuleInit {
  private readonly logger = new Logger(SalesScheduler.name);

  constructor(private readonly salesService: SalesService) {}

  onModuleInit() {
    this.logger.log('Initialized — triggering initial fetch...');
    this.scheduledSalesFetch();
  }
  @Cron('0 0 * * 4', { timeZone: 'America/New_York' }) // Thursday midnight ET
  async scheduledSalesFetch() {
    // 1. Cleanup any historically failed reports first
    await this.salesService.retryUntilAllComplete();

    // 2. Start the new weekly fetch
    // Runs on Thursday — previous Saturday is always 5 days back
    const now = new Date();

    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() - 5); // Thursday - 5 = last Saturday
    endDate.setHours(23, 59, 59, 999);

    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 6); // Saturday - 6 = last Sunday
    startDate.setHours(0, 0, 0, 0);

    this.logger.log(
      `Starting weekly fetch | window: ${startDate.toISOString()} to ${endDate.toISOString()}`,
    );

    try {
      await this.salesService.fetchAndStoreReports(startDate, endDate);
      this.logger.log('Weekly fetch completed successfully.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Weekly fetch fatal error: ${message}`);
    }
  }
}
