import { Controller,Get,Req,Query,UseGuards } from '@nestjs/common';
import { movementQuerySchema,documentQuerySchema } from '@tirek/contracts';
import { AuthRequest,SessionGuard } from '../../auth/session.guard';
import { ReportsService } from './reports.service';
@Controller()
@UseGuards(SessionGuard)
export class ReportsController {
 constructor(private readonly reports:ReportsService){}
 @Get('movements/search') movements(@Req() req:AuthRequest,@Query() query:unknown){return this.reports.movements(req.user.organizationId,movementQuerySchema.parse(query));}
 @Get('documents/search') documents(@Req() req:AuthRequest,@Query() query:unknown){return this.reports.documents(req.user.organizationId,documentQuerySchema.parse(query));}
}
