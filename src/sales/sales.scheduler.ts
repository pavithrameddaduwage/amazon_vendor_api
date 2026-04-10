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
  @Cron('0 0 * * 3', { timeZone: 'America/New_York' })
  async scheduledSalesFetch() {
    // 1. Cleanup any historically failed reports first
    await this.salesService.retryUntilAllComplete();

    // 2. Start the new weekly fetch
    const now = new Date();

    // Previous completed Saturday
    const endDate = new Date(now);
    const day = endDate.getDay(); // 0=Sun, 1=Mon, 2=Tue, 3=Wed, ...
    const daysBackToPreviousSaturday = day + 4; // Wed->4, Thu->5, Fri->6, Sat->7, Sun->8, Mon->9, Tue->10
    endDate.setDate(endDate.getDate() - daysBackToPreviousSaturday);
    endDate.setHours(23, 59, 59, 999);

    // Corresponding Sunday
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 6);
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
