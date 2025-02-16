import { EntityRepository, Repository } from 'typeorm';
import { AmazonInventoryByAsin } from '../amazon_inventory_by_asin.entity';
import { AmazonInventoryReport } from '../amazon_inventory_report.entity';   

@EntityRepository(AmazonInventoryByAsin)
export class AmazonInventoryByAsinRepository extends Repository<AmazonInventoryByAsin> {
  // Fixing the method to correctly accept an array of Partial<AmazonInventoryByAsin>
  async insertInventoryByAsin(report: AmazonInventoryReport, data: Partial<AmazonInventoryByAsin>[]) {
    try {
      // Loop through each ASIN object and insert it
      for (const asinData of data) {
        const asin = this.create({
          ...asinData,  // Spread the incoming data
          report,       // Associate with the report
        });

        console.log(`Inserting ASIN: ${asin.asin}`);

        await this.save(asin); // Save the ASIN inventory data
      }

      console.log('✅ ASIN inventory data successfully inserted.');
    } catch (error) {
      console.error('❌ Error inserting ASIN inventory data:', error);
    }
  }
}
