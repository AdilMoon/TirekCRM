import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuditWriterModule } from '../modules/audit/audit-writer.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionGuard } from './session.guard';
import { PasswordResetController } from './password-reset.controller';
import { PasswordResetService } from './password-reset.service';
import { PasswordResetDelivery } from './password-reset-delivery';
import { MailModule } from '../modules/mail/mail.module';
@Module({imports:[DatabaseModule,AuditWriterModule,MailModule],controllers:[AuthController,PasswordResetController],providers:[SessionGuard,AuthService,PasswordResetService,PasswordResetDelivery],exports:[SessionGuard]})
export class AuthModule {}
