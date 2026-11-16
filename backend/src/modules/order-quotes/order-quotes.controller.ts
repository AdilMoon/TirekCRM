import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import { publishQuoteSchema, quoteAcceptSchema, quoteAccessSchema } from '@tirek/contracts';
import { PublicAccess } from '../../auth/access';
import { SessionGuard, type AuthRequest } from '../../auth/session.guard';
import { OrderQuotesService } from './order-quotes.service';

@Controller()
@UseGuards(SessionGuard)
export class OrderQuotesController {
  constructor(private readonly quotes: OrderQuotesService) {}

  @Get('orders/:id/quotes')
  list(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.list(req.user, id);
  }

  @Post('orders/:id/quotes')
  @RouteConfig({ rateLimit: { max: 15, timeWindow: '1 minute' } })
  publish(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.quotes.publish(req.user, id, publishQuoteSchema.parse(body));
  }

  @Delete('orders/:id/quotes/:quoteId/link')
  revoke(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Param('quoteId', ParseUUIDPipe) quoteId: string) {
    return this.quotes.revoke(req.user, id, quoteId);
  }

  @Post('quote/read')
  @PublicAccess()
  @HttpCode(200)
  @RouteConfig({ rateLimit: { max: 30, timeWindow: '1 minute' } })
  read(@Body() body: unknown) {
    return this.quotes.read(quoteAccessSchema.parse(body).token);
  }

  @Post('quote/accept')
  @PublicAccess()
  @HttpCode(200)
  @RouteConfig({ rateLimit: { max: 15, timeWindow: '1 minute' } })
  accept(@Body() body: unknown) {
    const { token, revision } = quoteAcceptSchema.parse(body);
    return this.quotes.accept(token, revision);
  }
}
