import { Controller, Get, Query } from '@nestjs/common';
import { InventoryService } from './inventory.service';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('fetch')
  async fetchInventoryReports(
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

      await this.inventoryService.fetchAndStoreReports(startDate, endDate);

      return {
        message: `Inventory report processing started from ${startDate.toISOString()} to ${endDate.toISOString()}`,
      };
    } catch (error) {
      console.error('Error processing inventory reports:', error);
      return { message: 'Error processing inventory reports', error: error.message };
    }
  }
}
