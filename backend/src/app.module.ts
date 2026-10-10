import { ReportsModule } from './modules/reports/reports.module';
import { TeamModule } from './modules/team/team.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { Module } from '@nestjs/common';
import { CrmModule } from './modules/crm/crm.module';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health.controller';
@Module({imports:[OnboardingModule,DatabaseModule,AuthModule,CrmModule,TeamModule,TasksModule,ReportsModule],controllers:[HealthController]})
export class AppModule {}
