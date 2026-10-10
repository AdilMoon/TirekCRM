import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../../auth/auth.module';
import { AuditWriterModule } from '../audit/audit-writer.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

@Module({imports:[DatabaseModule,AuthModule,AuditWriterModule],controllers:[OnboardingController],providers:[OnboardingService]})
export class OnboardingModule {}
