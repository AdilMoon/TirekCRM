import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { DatabaseModule } from '../../database/database.module';
import { AuditWriterModule } from '../audit/audit-writer.module';
import { WorkTimeController } from './work-time.controller';
import { WorkTimeService } from './work-time.service';

@Module({
  imports: [DatabaseModule, AuthModule, AuditWriterModule],
  controllers: [WorkTimeController],
  providers: [WorkTimeService],
})
export class WorkTimeModule {}
