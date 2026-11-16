import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyReply } from 'fastify';
import { workTimeAllocationSchema, workTimeDecisionSchema, workTimeEntrySchema, workTimeMonthSchema, workTimeOrderSearch, workTimeQuerySchema } from '@tirek/contracts';
import { EmployeeAccess } from '../../auth/access';
import { SessionGuard, type AuthRequest } from '../../auth/session.guard';
import { WorkTimeService } from './work-time.service';

@Controller('work-time')
@UseGuards(SessionGuard)
export class WorkTimeController {
  constructor(private readonly workTime: WorkTimeService) {}

  @Get()
  @EmployeeAccess()
  list(@Req() req: AuthRequest, @Query() query: unknown) {
    return this.workTime.list(req.user, workTimeQuerySchema.parse(query));
  }

  @Get('people')
  people(@Req() req: AuthRequest) {
    return this.workTime.people(req.user);
  }

  @Get('orders')
  @EmployeeAccess()
  orders(@Req() req: AuthRequest, @Query() query: unknown) {
    return this.workTime.orders(req.user, workTimeOrderSearch.parse(query).q);
  }

  @Post('close')
  @RouteConfig({ rateLimit: { max: 10, timeWindow: '1 minute' } })
  closeMonth(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.workTime.closeMonth(req.user, workTimeMonthSchema.parse(body).month);
  }

  @Get('export')
  @RouteConfig({ rateLimit: { max: 10, timeWindow: '1 minute' } })
  async exportMonth(@Req() req: AuthRequest, @Query() query: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const { month } = workTimeMonthSchema.parse(query);
    const csv = await this.workTime.exportMonth(req.user, month);
    reply.type('text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="tirek-timesheet-' + month + '.csv"');
    return csv;
  }

  @Post()
  @EmployeeAccess()
  create(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.workTime.create(req.user, workTimeEntrySchema.parse(body));
  }

  @Patch(':id/decision')
  decide(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.workTime.decide(req.user, id, workTimeDecisionSchema.parse(body));
  }

  @Patch(':id/order')
  allocate(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.workTime.allocate(req.user, id, workTimeAllocationSchema.parse(body));
  }
}
