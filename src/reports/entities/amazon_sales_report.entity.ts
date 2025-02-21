import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { AmazonSalesAggregate } from './amazon_sales_aggregate.entity';
import { AmazonSalesByAsin } from './amazon_sales_by_asin.entity';

@Entity('amazon_sales_report')
export class AmazonSalesReport {
  @PrimaryGeneratedColumn()
  id: number; // Primary key for AmazonSalesReport

  @Column()
  reportType: string;

  @Column()
  reportPeriod: string;

  @Column()
  sellingProgram: string;

  @Column()
  distributorView: string;

  @Column({ type: 'timestamp' })
  lastUpdatedDate: Date;

  @Column({ type: 'timestamp' })
  dataStartTime: Date;

  @Column({ type: 'timestamp' })
  dataEndTime: Date;

  @Column('text', { array: true })
  marketplaceIds: string[];

  
 
}
