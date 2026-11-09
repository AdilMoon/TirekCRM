import {FinanceModule} from './modules/finance/finance.module';
import {SmartOrdersModule} from './modules/smart-orders/smart-orders.module';
import {SchedulingModule} from './modules/scheduling/scheduling.module';
import {TelegramModule} from './modules/telegram/telegram.module';
import {PrivacyRequestsModule} from './modules/privacy-requests/privacy-requests.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ReportsModule } from './modules/reports/reports.module';
import { TeamModule } from './modules/team/team.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { Module } from '@nestjs/common';
import { CrmModule } from './modules/crm/crm.module';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health.controller';
@Module({imports:[TelegramModule,SchedulingModule,SmartOrdersModule,FinanceModule,PrivacyRequestsModule,DocumentsModule,NotificationsModule,OnboardingModule,DatabaseModule,AuthModule,CrmModule,TeamModule,TasksModule,ReportsModule],controllers:[HealthController]})
export class AppModule {}
