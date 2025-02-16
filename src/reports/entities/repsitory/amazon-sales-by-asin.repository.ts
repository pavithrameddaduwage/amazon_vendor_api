import { EntityRepository, Repository } from 'typeorm';
import { AmazonSalesByAsin } from '../amazon_sales_by_asin.entity';

@EntityRepository(AmazonSalesByAsin)
export class AmazonSalesByAsinRepository extends Repository<AmazonSalesByAsin> {
  async insertSalesByAsin(data: Partial<AmazonSalesByAsin>) {
    try {
      const salesByAsin = this.create(data); // Create a new entity
      return await this.save(salesByAsin); // Save the entity
    } catch (error) {
      console.error('Error inserting sales by ASIN:', error);
      throw new Error('Failed to insert sales by ASIN');
    }
  }
}
