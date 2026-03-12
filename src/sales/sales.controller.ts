import { Controller, Get, Query } from '@nestjs/common';
import { SalesService } from './sales.service';

@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Get('fetch')
  async fetchSalesReports(
    @Query('startDate') startDateParam?: string,
    @Query('endDate') endDateParam?: string,
  ) {
    try {
      const startDate = startDateParam
        ? new Date(startDateParam)
        : new Date(new Date().getFullYear(), 0, 1);
      const endDate = endDateParam ? new Date(endDateParam) : new Date();

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new Error('Invalid date format provided.');
      }

      await this.salesService.fetchAndStoreReports(startDate, endDate);

      return {
        message: `Sales report processing started from ${startDate.toISOString()} to ${endDate.toISOString()}`,
      };
    } catch (error) {
      console.error('Error processing sales reports:', error);
      return { message: 'Error processing sales reports', error: error.message };
    }
  }
}
