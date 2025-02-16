import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { AmazonInventoryReport } from './amazon_inventory_report.entity';

@Entity('amazon_inventory_aggregate')

export class AmazonVendorInventory {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => AmazonInventoryReport, (report) => report.inventoryAggregates)
  report: AmazonInventoryReport;

  @Column({ name: 'start_date' })
  startDate: Date;

  @Column({ name: 'end_date' })
  endDate: Date;

  @Column('float', { nullable: true, name: 'sourceable_product_out_of_stock_rate' })
  sourceableProductOutOfStockRate: number;

  @Column('float', { nullable: true, name: 'procurable_product_out_of_stock_rate' })
  procurableProductOutOfStockRate: number;

  @Column({ name: 'open_purchase_order_units' })
  openPurchaseOrderUnits: number;

  @Column('float', { name: 'receive_fill_rate' })
  receiveFillRate: number;

  @Column('float', { name: 'average_vendor_lead_time_days' })
  averageVendorLeadTimeDays: number;

  @Column({ type: 'float', nullable: true, name: 'net_received_inventory_cost_amount' })
  netReceivedInventoryCostAmount: number;

  @Column({ nullable: true, name: 'net_received_inventory_cost_currency_code' })
  netReceivedInventoryCostCurrencyCode: string;

  @Column({ type: 'float', nullable: true, name: 'sellable_on_hand_inventory_cost_amount' })
  sellableOnHandInventoryCostAmount: number;

  @Column({ nullable: true, name: 'sellable_on_hand_inventory_cost_currency_code' })
  sellableOnHandInventoryCostCurrencyCode: string;

  @Column({ type: 'float', nullable: true, name: 'unsellable_on_hand_inventory_cost_amount' })
  unsellableOnHandInventoryCostAmount: number;

  @Column({ nullable: true, name: 'unsellable_on_hand_inventory_cost_currency_code' })
  unsellableOnHandInventoryCostCurrencyCode: string;

  @Column({ type: 'float', nullable: true, name: 'aged_90_plus_days_sellable_inventory_cost_amount' })
  aged90PlusDaysSellableInventoryCostAmount: number;

  @Column({ nullable: true, name: 'aged_90_plus_days_sellable_inventory_cost_currency_code' })
  aged90PlusDaysSellableInventoryCostCurrencyCode: string;
   
}