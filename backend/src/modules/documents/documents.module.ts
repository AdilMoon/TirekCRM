import {Module} from '@nestjs/common';
import {DatabaseModule} from '../../database/database.module';
import {AuthModule} from '../../auth/auth.module';
import {AuditModule} from '../audit/audit.module';
import {InvoicesController} from './invoices.controller';
import {InvoicesService} from './invoices.service';
import {AnnulmentController} from './annulment.controller';
import {AnnulmentService} from './annulment.service';
@Module({imports:[DatabaseModule,AuthModule,AuditModule],controllers:[InvoicesController,AnnulmentController],providers:[InvoicesService,AnnulmentService]})
export class DocumentsModule {}
