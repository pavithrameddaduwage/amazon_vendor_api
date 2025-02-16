import { EntityRepository, Repository } from 'typeorm';
import { AmazonVendorInventory } from '../amazon_vendor_inventory.entity';

@EntityRepository(AmazonVendorInventory)
export class AmazonVendorInventoryRepository extends Repository<AmazonVendorInventory> {
  async insertVendorInventory(data: Partial<AmazonVendorInventory>) {
    const inventory = this.create(data); // Create a new entity
    return await this.save(inventory); // Save the entity to the database
  }
}
