import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { ApiController } from './crm.controller';
import { CrmService } from './crm.service';
import { SearchService } from './search.service';
import {OrderQualityService} from './order-quality.service';
import {OrderQualityController} from './order-quality.controller';
import {ClientOverviewController} from './client-overview.controller';
import {ClientOverviewService} from './client-overview.service';
@Module({imports:[DatabaseModule,AuthModule,AuditModule],controllers:[ApiController,OrderQualityController,ClientOverviewController],providers:[CrmService,SearchService,OrderQualityService,ClientOverviewService]})
export class CrmModule {}
