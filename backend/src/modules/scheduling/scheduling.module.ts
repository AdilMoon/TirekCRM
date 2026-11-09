import {Module} from '@nestjs/common';
import {DatabaseModule} from '../../database/database.module';
import {AuthModule} from '../../auth/auth.module';
import {AuditWriterModule} from '../audit/audit-writer.module';
import {SchedulingService} from './scheduling.service';
import {SchedulingController} from './scheduling.controller';
@Module({imports:[DatabaseModule,AuthModule,AuditWriterModule],providers:[SchedulingService],controllers:[SchedulingController]})
export class SchedulingModule {}
