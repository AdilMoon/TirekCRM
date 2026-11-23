import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { ApiController } from './crm.controller';
import { CrmService } from './crm.service';
import { SearchService } from './search.service';
import {OrderQualityService} from './order-quality.service';
import {OrderQualityController} from './order-quality.controller';
@Module({imports:[DatabaseModule,AuthModule,AuditModule],controllers:[ApiController,OrderQualityController],providers:[CrmService,SearchService,OrderQualityService]})
export class CrmModule {}
