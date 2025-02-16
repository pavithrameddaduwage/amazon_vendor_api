import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { AmazonForecastingReport } from './amazon_forecasting_report.entity';

@Entity('amazon_forecast_by_asin')
export class AmazonForecastByAsin {
  @PrimaryGeneratedColumn()
  forecastByAsinId: number;

  @ManyToOne(() => AmazonForecastingReport, report => report.forecastByAsins)
  report: AmazonForecastingReport;

  @Column({ nullable: true })
  forecastGenerationDate: Date;

  @Column({ nullable: true })
  asin: string;

  @Column({ nullable: true })
  startDate: Date;

  @Column({ nullable: true })
  endDate: Date;

  @Column({ nullable: true })
  meanForecastUnits: number;

  @Column({ nullable: true })
  p70ForecastUnits: number;

  @Column({ nullable: true })
  p80ForecastUnits: number;

  @Column({ nullable: true })
  p90ForecastUnits: number;
}
