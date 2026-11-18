import {Module} from '@nestjs/common';
import {DatabaseModule} from '../../database/database.module';
import {AuthModule} from '../../auth/auth.module';
import {AuditModule} from '../audit/audit.module';
import {FinanceController} from './finance.controller';
import {FinanceService} from './finance.service';
import { ExpenseReceiptsController } from './expense-receipts.controller';
import { ExpenseReceiptsService } from './expense-receipts.service';
import { MaterialsController } from './materials.controller';
import { MaterialsService } from './materials.service';
@Module({imports:[DatabaseModule,AuthModule,AuditModule],controllers:[FinanceController,ExpenseReceiptsController,MaterialsController],
 providers:[FinanceService,ExpenseReceiptsService,MaterialsService],exports:[ExpenseReceiptsService]})
export class FinanceModule {}
