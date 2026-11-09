import {Module} from '@nestjs/common';
import {DatabaseModule} from '../../database/database.module';
import {AuthModule} from '../../auth/auth.module';
import {AuditWriterModule} from '../audit/audit-writer.module';
import {MessageOrdersService} from './message-orders.service';
import {PassportService} from './passport.service';
import {SmartOrdersController} from './smart-orders.controller';
@Module({imports:[DatabaseModule,AuthModule,AuditWriterModule],providers:[MessageOrdersService,PassportService],controllers:[SmartOrdersController],exports:[PassportService]})
export class SmartOrdersModule {}
