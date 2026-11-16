import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { DatabaseModule } from '../../database/database.module';
import { AuditWriterModule } from '../audit/audit-writer.module';
import { OrderQuotesController } from './order-quotes.controller';
import { OrderQuotesService } from './order-quotes.service';

@Module({
  imports: [AuthModule, DatabaseModule, AuditWriterModule],
  controllers: [OrderQuotesController],
  providers: [OrderQuotesService],
})
export class OrderQuotesModule {}
