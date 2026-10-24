import {Module} from '@nestjs/common';
import {DatabaseModule} from '../../database/database.module';
import {AuthModule} from '../../auth/auth.module';
import {AuditModule} from '../audit/audit.module';
import {FinanceController} from './finance.controller';
import {FinanceService} from './finance.service';
@Module({imports:[DatabaseModule,AuthModule,AuditModule],controllers:[FinanceController],providers:[FinanceService]})
export class FinanceModule {}
