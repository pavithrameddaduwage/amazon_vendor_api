import { EntityRepository, Repository } from 'typeorm';
import { AmazonSalesAggregate } from '../amazon_sales_aggregate.entity';

@EntityRepository(AmazonSalesAggregate)
export class AmazonSalesAggregateRepository extends Repository<AmazonSalesAggregate> {
  async insertSalesAggregate(data: Partial<AmazonSalesAggregate>) {
    try {
      const salesAggregate = this.create(data); // Create a new entity
      return await this.save(salesAggregate); // Save the entity
    } catch (error) {
      console.error('Error inserting sales aggregate:', error);
      throw new Error('Failed to insert sales aggregate');
    }
  }
}
