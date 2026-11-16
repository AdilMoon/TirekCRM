import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Req, UseGuards } from '@nestjs/common';
import { orderProfitabilitySchema } from '@tirek/contracts';
import { SessionGuard, type AuthRequest } from '../../auth/session.guard';
import { OrderProfitabilityService } from './order-profitability.service';

@Controller('orders/:id/profitability')
@UseGuards(SessionGuard)
export class OrderProfitabilityController {
  constructor(private readonly profitability: OrderProfitabilityService) {}

  @Get()
  detail(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.profitability.detail(req.user, id.toLowerCase());
  }

  @Patch()
  save(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.profitability.save(req.user, id.toLowerCase(), orderProfitabilitySchema.parse(body));
  }
}
