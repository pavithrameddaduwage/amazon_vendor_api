import { Injectable } from "@nestjs/common";
import { SalesReportService } from "./sales-report.service";

@Injectable()
export class ReportsService {
  constructor(private readonly salesReportService: SalesReportService) {}

  public async fetchAndStoreReports(reportType: string, startDate: Date, endDate: Date) {
    await this.salesReportService.fetchAndStoreReports(startDate, endDate);

  }
}
