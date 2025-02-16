import { EntityRepository, Repository } from 'typeorm';
import { AmazonForecastingReport } from '../amazon_forecasting_report.entity';

@EntityRepository(AmazonForecastingReport)
export class AmazonForecastingReportRepository extends Repository<AmazonForecastingReport> {
  // Inserting data into the AmazonForecastingReport table
  async insertAmazonForecastingReport(reportData: Partial<AmazonForecastingReport>) {
    const report = this.create(reportData);  // Create an entity from the input data
    return await this.save(report);  // Save the entity to the database
  }
}
