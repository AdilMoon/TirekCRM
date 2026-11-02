import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../../auth/auth.module';
import { AuditWriterModule } from '../audit/audit-writer.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { MailModule } from '../mail/mail.module';

@Module({imports:[DatabaseModule,AuthModule,AuditWriterModule,MailModule],controllers:[OnboardingController],providers:[OnboardingService]})
export class OnboardingModule {}
