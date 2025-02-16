import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { AmazonInventoryReport } from './amazon_inventory_report.entity';

@Entity('amazon_inventory_by_asin')
export class AmazonInventoryByAsin {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => AmazonInventoryReport, (report) => report.inventoryByAsins)
  report: AmazonInventoryReport;

  @Column({ type: 'date', nullable: true, name: 'start_date' })
  startDate: Date;

  @Column({ type: 'date', nullable: true, name: 'end_date' })
  endDate: Date;

  @Column({ nullable: true, name: 'asin' })
  asin: string;

  @Column({ type: 'float', nullable: true, name: 'sourceable_product_out_of_stock_rate' })
  sourceableProductOutOfStockRate: number;

  @Column({ type: 'float', nullable: true, name: 'procurable_product_out_of_stock_rate' })
  procurableProductOutOfStockRate: number;

  @Column({ nullable: true, name: 'open_purchase_order_units' })
  openPurchaseOrderUnits: number;

  @Column({ type: 'float', nullable: true, name: 'receive_fill_rate' })
  receiveFillRate: number;

  @Column({ type: 'float', nullable: true, name: 'average_vendor_lead_time_days' })
  averageVendorLeadTimeDays: number;

  @Column({ type: 'float', nullable: true, name: 'sell_through_rate' })
  sellThroughRate: number;

  @Column({ nullable: true, name: 'unfilled_customer_ordered_units' })
  unfilledCustomerOrderedUnits: number;

  @Column({ type: 'float', nullable: true, name: 'vendor_confirmation_rate' })
  vendorConfirmationRate: number;

  @Column({ type: 'float', nullable: true, name: 'net_received_inventory_cost_amount' })
  netReceivedInventoryCostAmount: number;

  @Column({ nullable: true, name: 'net_received_inventory_cost_currency_code' })
  netReceivedInventoryCostCurrencyCode: string;

  @Column({ nullable: true, name: 'net_received_inventory_units' })
  netReceivedInventoryUnits: number;

  @Column({ type: 'float', nullable: true, name: 'sellable_on_hand_inventory_cost_amount' })
  sellableOnHandInventoryCostAmount: number;

  @Column({ nullable: true, name: 'sellable_on_hand_inventory_cost_currency_code' })
  sellableOnHandInventoryCostCurrencyCode: string;

  @Column({ nullable: true, name: 'sellable_on_hand_inventory_units' })
  sellableOnHandInventoryUnits: number;

  @Column({ type: 'float', nullable: true, name: 'unsellable_on_hand_inventory_cost_amount' })
  unsellableOnHandInventoryCostAmount: number;

  @Column({ nullable: true, name: 'unsellable_on_hand_inventory_cost_currency_code' })
  unsellableOnHandInventoryCostCurrencyCode: string;

  @Column({ nullable: true, name: 'unsellable_on_hand_inventory_units' })
  unsellableOnHandInventoryUnits: number;

  @Column({ type: 'float', nullable: true, name: 'aged_90_plus_days_sellable_inventory_cost_amount' })
  aged90PlusDaysSellableInventoryCostAmount: number;

  @Column({ nullable: true, name: 'aged_90_plus_days_sellable_inventory_cost_currency_code' })
  aged90PlusDaysSellableInventoryCostCurrencyCode: string;

  @Column({ nullable: true, name: 'aged_90_plus_days_sellable_inventory_units' })
  aged90PlusDaysSellableInventoryUnits: number;
}
