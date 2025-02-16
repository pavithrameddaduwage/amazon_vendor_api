import { EntityRepository, Repository } from 'typeorm';
import { AmazonSalesReport } from '../amazon_sales_report.entity';
 

@EntityRepository(AmazonSalesReport)
export class AmazonSalesReportRepository extends Repository<AmazonSalesReport> {}
