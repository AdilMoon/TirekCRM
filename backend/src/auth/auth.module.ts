import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuditWriterModule } from '../modules/audit/audit-writer.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionGuard } from './session.guard';
@Module({imports:[DatabaseModule,AuditWriterModule],controllers:[AuthController],providers:[SessionGuard,AuthService],exports:[SessionGuard]})
export class AuthModule {}
