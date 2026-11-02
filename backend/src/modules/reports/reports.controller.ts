import { Controller,Get,Req,Res,Query,UseGuards } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyReply } from 'fastify';
import { movementQuerySchema,movementExportQuerySchema,documentQuerySchema } from '@tirek/contracts';
import { AuthRequest,SessionGuard } from '../../auth/session.guard';
import { ReportsService } from './reports.service';
@Controller()
@UseGuards(SessionGuard)
export class ReportsController {
 constructor(private readonly reports:ReportsService){}
 @Get('movements/search') movements(@Req() req:AuthRequest,@Query() query:unknown){return this.reports.movements(req.user.organizationId,movementQuerySchema.parse(query));}
 @Get('movements/export')
 @RouteConfig({rateLimit:{max:10,timeWindow:'1 minute'}})
 async exportMovements(@Req() req:AuthRequest,@Query() query:unknown,@Res({passthrough:true}) reply:FastifyReply){
  // Set attachment headers only after validation and successful generation: errors stay JSON.
  const report=await this.reports.exportMovements(req.user.organizationId,movementExportQuerySchema.parse(query));
  reply.type('text/csv; charset=utf-8').header('Content-Disposition','attachment; filename="tirek-movements.csv"')
   .header('X-Report-Total',String(report.total)).header('X-Report-Received',report.summary.received)
   .header('X-Report-Expenses',report.summary.expenses).header('X-Report-Cash-Flow',report.summary.cashFlow);
  return report.csv;
 }
 @Get('documents/search') documents(@Req() req:AuthRequest,@Query() query:unknown){return this.reports.documents(req.user.organizationId,documentQuerySchema.parse(query));}
}
