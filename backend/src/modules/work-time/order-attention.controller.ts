import {Controller,Get,Query,Req,UseGuards} from '@nestjs/common';
import {RouteConfig} from '@nestjs/platform-fastify';
import type {FastifyRequest} from 'fastify';
import {attentionQuerySchema} from '@tirek/contracts';
import {SessionGuard,digest,type AuthRequest} from '../../auth/session.guard';
import {OrderAttentionService} from './order-attention.service';
@Controller('orders/attention')
@UseGuards(SessionGuard)
export class OrderAttentionController {
  constructor(private readonly attention:OrderAttentionService){}
  @Get()
  @RouteConfig({rateLimit:{max:60,timeWindow:'1 minute',keyGenerator:(request:FastifyRequest)=>{
    const token=request.cookies?.tirek_session;
    return token&&/^[a-f0-9]{64}$/.test(token)?digest(token):request.ip;
  }}})
  list(@Req() req:AuthRequest,@Query() query:unknown){return this.attention.list(req.user,attentionQuerySchema.parse(query));}
}
