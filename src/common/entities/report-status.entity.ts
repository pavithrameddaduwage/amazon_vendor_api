import { Entity, Column, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('report_status')
@Unique(['reportId'])
export class ReportStatusEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: true })
  reportId: string;

  @Column({ nullable: true })
  reportDocumentId?: string;

  @Column()
  reportType: string;

  @Column({ type: 'timestamp' })
  dataStartTime: Date;

  @Column({ type: 'timestamp' })
  dataEndTime: Date;

  @Column({ type: 'timestamp', nullable: true })
  createdTime?: Date;

  @Column({ default: 'IN_PROGRESS' })
  status: string;

  @Column({ nullable: true })
  errorMessage?: string;

  @Column({ default: 0 })
  retryCount: number;
}
