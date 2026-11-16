import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Req, Res, UseGuards } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import { orderEffortFilter, orderEffortPlanSchema, orderEffortQuery } from '@tirek/contracts';
import type { FastifyReply } from 'fastify';
import { SessionGuard, type AuthRequest } from '../../auth/session.guard';
import { OrderEffortService } from './order-effort.service';

@Controller()
@UseGuards(SessionGuard)
export class OrderEffortController {
  constructor(private readonly effort: OrderEffortService) {}

  @Get('orders/:id/effort')
  detail(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.effort.detail(req.user, id);
  }

  @Patch('orders/:id/effort')
  savePlan(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.effort.savePlan(req.user, id, orderEffortPlanSchema.parse(body));
  }

  @Get('order-effort')
  list(@Req() req: AuthRequest, @Query() query: unknown) {
    return this.effort.list(req.user, orderEffortQuery.parse(query));
  }

  @Get('order-effort/export')
  @RouteConfig({ rateLimit: { max: 10, timeWindow: '1 minute' } })
  async export(@Req() req: AuthRequest, @Query() query: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const csv = await this.effort.export(req.user, orderEffortFilter.parse(query));
    reply.type('text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="tirek-order-effort.csv"');
    return csv;
  }
}
