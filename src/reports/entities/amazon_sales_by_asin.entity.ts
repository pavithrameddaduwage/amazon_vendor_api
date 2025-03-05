import { Entity, PrimaryColumn, Column, ManyToOne } from 'typeorm';
import { AmazonSalesAggregate } from './amazon_sales_aggregate.entity';
import { Exclude } from 'class-transformer';

@Entity('amazon_sales_by_asin')
export class AmazonSalesByAsin {
  @PrimaryColumn({ name: 'start_date' })
  startDate: string;

  @PrimaryColumn({ name: 'end_date' })
  endDate: string;

  @PrimaryColumn({ name: 'asin' })
  asin: string;

  @Column({ type: 'int', default: 0, name: 'customer_returns' })
  customerReturns: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, name: 'shipped_cogs_amount' })
  shippedCogsAmount: number;

  @Column({ default: 'USD', name: 'shipped_cogs_currency' })
  shippedCogsCurrency: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, name: 'shipped_revenue_amount' })
  shippedRevenueAmount: number;

  @Column({ default: 'USD', name: 'shipped_revenue_currency' })
  shippedRevenueCurrency: string;

  @Column({ type: 'int', default: 0, name: 'shipped_units' })
  shippedUnits: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, name: 'ordered_revenue_amount' })
  orderedRevenueAmount: number;

  @Column({ default: 'USD', name: 'ordered_revenue_currency' })
  orderedRevenueCurrency: string;

  @Column({ type: 'int', default: 0, name: 'ordered_units' })
  orderedUnits: number;
}
