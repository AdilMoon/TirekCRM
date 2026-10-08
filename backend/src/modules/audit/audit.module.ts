import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../../auth/auth.module';
import { AuditWriterModule } from './audit-writer.module';
import { AuditController } from './audit.controller';
@Module({imports:[DatabaseModule,AuditWriterModule,AuthModule],controllers:[AuditController],exports:[AuditWriterModule]})
export class AuditModule {}
