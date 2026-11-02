import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { MailQueue } from './mail-queue';
import { MailTransport } from './mail-transport';
import { MailWorker } from './mail-worker';
@Module({imports:[DatabaseModule],providers:[MailQueue,MailTransport,MailWorker],exports:[MailQueue]})
export class MailModule {}
