import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { receiptDecisionSchema, receiptListSchema } from '@tirek/contracts';
import { SessionGuard, type AuthRequest } from '../../auth/session.guard';
import { ExpenseReceiptsService } from './expense-receipts.service';

@Controller('finance/receipts')
@UseGuards(SessionGuard)
export class ExpenseReceiptsController {
  constructor(private readonly receipts: ExpenseReceiptsService) {}

  @Get()
  list(@Req() req: AuthRequest, @Query() query: unknown) {
    return this.receipts.list(req.user.organizationId, receiptListSchema.parse(query));
  }

  @Get(':id/photo')
  async photo(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Res() reply: FastifyReply) {
    const image = await this.receipts.photo(req.user.organizationId, id);
    return reply.type('image/jpeg').send(image);
  }

  @Patch(':id')
  decide(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.receipts.decide(req.user, id, receiptDecisionSchema.parse(body));
  }
}
