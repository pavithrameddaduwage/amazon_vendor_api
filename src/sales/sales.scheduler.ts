import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SalesService } from './sales.service';

@Injectable()
export class SalesScheduler implements OnModuleInit {
  private readonly logger = new Logger(SalesScheduler.name);

  constructor(private readonly salesService: SalesService) {}

  onModuleInit() {
    this.logger.log('Initialized — triggering initial fetch...');

    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 14);
    startDate.setHours(0, 0, 0, 0);

    this.salesService.fetchAndStoreReports(startDate, endDate).catch(err => {
      this.logger.error(`Initial fetch failed: ${err.message}`);
    });
  }

  @Cron('0 0 * * 2', { timeZone: 'America/New_York' })
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
      this.logger.error(`Weekly fetch fatal error: ${error.message}`);
    }
  }
}
