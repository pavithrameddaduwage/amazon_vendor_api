import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportStatusEntity } from './entities/report-status.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ReportStatusEntity])],
  exports: [TypeOrmModule],
})
export class CommonModule {}
