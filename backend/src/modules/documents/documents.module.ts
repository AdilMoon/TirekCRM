import {Module} from '@nestjs/common';
import {DatabaseModule} from '../../database/database.module';
import {AuthModule} from '../../auth/auth.module';
import {AuditModule} from '../audit/audit.module';
import {InvoicesController} from './invoices.controller';
import {InvoicesService} from './invoices.service';
@Module({imports:[DatabaseModule,AuthModule,AuditModule],controllers:[InvoicesController],providers:[InvoicesService]})
export class DocumentsModule {}
