import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('amazon_forecast_by_asin')
export class AmazonForecastByAsin {
  @PrimaryColumn({ name: 'forecast_generation_date', type: 'date' })
  forecastGenerationDate: Date;

  @PrimaryColumn({ name: 'asin' })
  asin: string;

  @Column({ name: 'start_date', type: 'date', nullable: true })
  startDate: Date;

  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate: Date;

  @Column({ name: 'mean_forecast_units', type: 'int', default: 0 })
  meanForecastUnits: number;

  @Column({ name: 'p70_forecast_units', type: 'int', default: 0 })
  p70ForecastUnits: number;

  @Column({ name: 'p80_forecast_units', type: 'int', default: 0 })
  p80ForecastUnits: number;

  @Column({ name: 'p90_forecast_units', type: 'int', default: 0 })
  p90ForecastUnits: number;
}
