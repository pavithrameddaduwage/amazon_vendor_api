import { EntityRepository, Repository } from 'typeorm';
import { ReportStatusEntity } from '../ReportStatusEntity';

@EntityRepository(ReportStatusEntity)
export class ReportStatusRepository extends Repository<ReportStatusEntity> {}
