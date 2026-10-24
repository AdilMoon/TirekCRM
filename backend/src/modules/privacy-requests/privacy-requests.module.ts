import {Module} from '@nestjs/common';
import {DatabaseModule} from '../../database/database.module';
import {AuthModule} from '../../auth/auth.module';
import {AuditModule} from '../audit/audit.module';
import {PrivacyRequestsController} from './privacy-requests.controller';
import {PrivacyRequestsService} from './privacy-requests.service';
@Module({imports:[DatabaseModule,AuthModule,AuditModule],controllers:[PrivacyRequestsController],providers:[PrivacyRequestsService]})
export class PrivacyRequestsModule {}
