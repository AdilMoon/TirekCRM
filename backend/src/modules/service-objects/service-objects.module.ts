import {Module} from '@nestjs/common';
import {DatabaseModule} from '../../database/database.module';
import {AuthModule} from '../../auth/auth.module';
import {AuditWriterModule} from '../audit/audit-writer.module';
import {ServiceObjectsController} from './service-objects.controller';
import {ServiceObjectsService} from './service-objects.service';
@Module({imports:[DatabaseModule,AuthModule,AuditWriterModule],providers:[ServiceObjectsService],controllers:[ServiceObjectsController]})
export class ServiceObjectsModule {}
