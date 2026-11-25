import {Controller,Get,Param,ParseUUIDPipe,Query,Req,UseGuards} from '@nestjs/common';
import {RouteConfig} from '@nestjs/platform-fastify';
import {clientOverviewQuerySchema} from '@tirek/contracts';
import {AuthRequest,SessionGuard} from '../../auth/session.guard';
import {ClientOverviewService} from './client-overview.service';
@Controller('clients/:id/overview')
@UseGuards(SessionGuard)
export class ClientOverviewController {
 constructor(private readonly service:ClientOverviewService){}
 @Get()
 @RouteConfig({rateLimit:{max:60,timeWindow:'1 minute'}})
 overview(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Query() query:unknown){
  return this.service.overview(req.user.organizationId,id.toLowerCase(),clientOverviewQuerySchema.parse(query));
 }
}
