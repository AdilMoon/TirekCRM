import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
@Module({imports:[DatabaseModule,AuthModule,AuditModule],controllers:[TasksController],providers:[TasksService]})
export class TasksModule {}
