import {Module} from '@nestjs/common';
import {DatabaseModule} from '../../database/database.module';
import {AuthModule} from '../../auth/auth.module';
import {AuditWriterModule} from '../audit/audit-writer.module';
import {SmartOrdersModule} from '../smart-orders/smart-orders.module';
import {TasksModule} from '../tasks/tasks.module';
import {TelegramService} from './telegram.service';
import {TelegramTransport} from './telegram-transport';
import {TelegramProcessor} from './telegram-processor';
import {TelegramWorker} from './telegram-worker';
import {TelegramController} from './telegram.controller';
@Module({imports:[DatabaseModule,AuthModule,AuditWriterModule,SmartOrdersModule,TasksModule],providers:[TelegramTransport,TelegramService,TelegramProcessor,TelegramWorker],controllers:[TelegramController]})
export class TelegramModule {}
