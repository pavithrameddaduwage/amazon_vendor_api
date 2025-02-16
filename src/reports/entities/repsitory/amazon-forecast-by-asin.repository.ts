import { EntityRepository, Repository } from 'typeorm';
import { AmazonForecastByAsin } from '../amazon_forecasting_by_asin.entity';

@EntityRepository(AmazonForecastByAsin)
export class AmazonForecastByAsinRepository extends Repository<AmazonForecastByAsin> {
  // Inserting data into the AmazonForecastByAsin table
  async insertAmazonForecastByAsin(forecastData: Partial<AmazonForecastByAsin>) {
    const forecast = this.create(forecastData);  // Create an entity from the input data
    return await this.save(forecast);  // Save the entity to the database
  }
}
