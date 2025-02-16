import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { AmazonVendorInventory } from './amazon_vendor_inventory.entity';
import { AmazonInventoryByAsin } from './amazon_inventory_by_asin.entity';

@Entity('amazon_inventory_report')
export class AmazonInventoryReport {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  reportType: string;

  @Column({ nullable: true })
  reportPeriod: string;

  @Column({ nullable: true })
  sellingProgram: string;

  @Column({ nullable: true })
  distributorView: string;

  @Column({ type: 'date', nullable: true })
  lastUpdatedDate: Date;

  @Column({ type: 'date', nullable: true })
  dataStartTime: Date;

  @Column({ type: 'date', nullable: true })
  dataEndTime: Date;

  @Column('simple-array', { nullable: true })
  marketplaceIds: string[];

  @OneToMany(() => AmazonVendorInventory, (inventory) => inventory.report)
  inventoryAggregates: AmazonVendorInventory[];

  @OneToMany(() => AmazonInventoryByAsin, (inventoryByAsin) => inventoryByAsin.report)
  inventoryByAsins: AmazonInventoryByAsin[];
}
