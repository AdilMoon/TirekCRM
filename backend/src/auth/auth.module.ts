import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthController } from './auth.controller';
import { SessionGuard } from './session.guard';
@Module({imports:[DatabaseModule],controllers:[AuthController],providers:[SessionGuard],exports:[SessionGuard]})
export class AuthModule {}
