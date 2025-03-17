import { Entity, Column, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('report_status')
@Unique(['reportId'])   
export class ReportStatusEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    reportType: string;

    @Column()
    reportId: string;    

    @Column({ type: 'timestamp' })
    startDate: Date;

    @Column({ type: 'timestamp' })
    endDate: Date;

    @Column({ default: 'IN_PROGRESS' })
    status: string;

    @Column({ nullable: true })
    errorMessage?: string;

    @Column({ default: 0 })
    retryCount: number;
}
