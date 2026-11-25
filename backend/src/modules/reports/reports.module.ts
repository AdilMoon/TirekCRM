import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../../auth/auth.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import {PaymentControlService} from './payment-control.service';
@Module({imports:[DatabaseModule,AuthModule],controllers:[ReportsController],providers:[ReportsService,PaymentControlService]})
export class ReportsModule {}
