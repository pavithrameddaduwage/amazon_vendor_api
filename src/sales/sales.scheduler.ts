import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SalesService } from './sales.service';

@Injectable()
export class SalesScheduler {
  private readonly logger = new Logger(SalesScheduler.name);

  constructor(private readonly salesService: SalesService) {}

  @Cron('0 0 * * 3', { timeZone: 'America/New_York' })
  async scheduledSalesFetch() {
    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 14);
    startDate.setHours(0, 0, 0, 0);

    this.logger.log(`Starting weekly fetch | window: ${startDate.toISOString()} to ${endDate.toISOString()}`);

    try {
      await this.salesService.fetchAndStoreReports(startDate, endDate);
      this.logger.log('Weekly fetch completed successfully.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Weekly fetch fatal error: ${message}`);
    }
  }
}
