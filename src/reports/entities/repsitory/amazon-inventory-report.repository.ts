import { EntityRepository, Repository } from 'typeorm';
import { AmazonInventoryReport } from '../amazon_inventory_report.entity';

@EntityRepository(AmazonInventoryReport)
export class AmazonInventoryReportRepository extends Repository<AmazonInventoryReport> {
  async insertInventoryReport(data: Partial<AmazonInventoryReport>) {
    const report = this.create(data); // Create a new entity
    return await this.save(report); // Save the entity to the database
  }
}
