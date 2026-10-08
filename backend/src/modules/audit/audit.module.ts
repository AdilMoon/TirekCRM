import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../../auth/auth.module';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
@Module({imports:[DatabaseModule,AuthModule],controllers:[AuditController],providers:[AuditService],exports:[AuditService]})
export class AuditModule {}
