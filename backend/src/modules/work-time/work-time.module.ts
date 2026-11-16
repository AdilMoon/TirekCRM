import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { DatabaseModule } from '../../database/database.module';
import { AuditWriterModule } from '../audit/audit-writer.module';
import { OrderEffortController } from './order-effort.controller';
import { OrderEffortService } from './order-effort.service';
import { OrderProfitabilityController } from './order-profitability.controller';
import { OrderProfitabilityService } from './order-profitability.service';
import { WorkTimeController } from './work-time.controller';
import { WorkTimeService } from './work-time.service';

@Module({
  imports: [DatabaseModule, AuthModule, AuditWriterModule],
  controllers: [WorkTimeController, OrderEffortController, OrderProfitabilityController],
  providers: [WorkTimeService, OrderEffortService, OrderProfitabilityService],
})
export class WorkTimeModule {}
