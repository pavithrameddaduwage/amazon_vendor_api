import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { AmazonForecastByAsin } from './amazon_forecasting_by_asin.entity';

@Entity('amazon_forecast_report_entity')
export class AmazonForecastingReport {
  @PrimaryGeneratedColumn()
  reportId: number;

  @Column({ nullable: true })
  reportType: string;

  @Column({ nullable: true })
  sellingProgram: string;

  @Column({ type: 'date', nullable: true })
  lastUpdatedDate: Date | null;

  @Column('text', { array: true, nullable: true })
  marketplaceIds: string[] | null;

  @Column({ type: 'date', nullable: true })
  startDate: Date | null;

  @Column({ type: 'date', nullable: true })
  endDate: Date | null;

  @OneToMany(() => AmazonForecastByAsin, forecastByAsin => forecastByAsin.report)
  forecastByAsins: AmazonForecastByAsin[];
}
