import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';
@Module({imports:[DatabaseModule,AuthModule,AuditModule],controllers:[TeamController],providers:[TeamService]})
export class TeamModule {}
