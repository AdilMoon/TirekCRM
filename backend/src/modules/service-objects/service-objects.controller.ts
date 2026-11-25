import {Body,Controller,Get,HttpCode,Param,ParseUUIDPipe,Post,Put,Query,Req,UseGuards} from '@nestjs/common';
import {RouteConfig} from '@nestjs/platform-fastify';
import {objectBindSchema,objectChoiceSchema,objectViewSchema,serviceDecisionSchema,serviceRequestSchema} from '@tirek/contracts';
import {SessionGuard,type AuthRequest} from '../../auth/session.guard';
import {EmployeeAccess,PublicAccess} from '../../auth/access';
import {ServiceObjectsService} from './service-objects.service';
@Controller() @UseGuards(SessionGuard)
export class ServiceObjectsController {
 constructor(private readonly objects:ServiceObjectsService){}
 @Get('orders/:id/service-object') @EmployeeAccess()
 context(@Req() r:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Query() query:unknown){return this.objects.context(r.user,id,objectViewSchema.parse(query));}
 @Get('orders/:id/service-objects')
 choices(@Req() r:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Query() query:unknown){return this.objects.choices(r.user,id,objectChoiceSchema.parse(query));}
 @Put('orders/:id/service-object')
 bind(@Req() r:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() body:unknown){return this.objects.bind(r.user,id,objectBindSchema.parse(body));}
 @Post('passport/service-requests') @PublicAccess() @HttpCode(200) @RouteConfig({rateLimit:{max:5,timeWindow:'1 minute'}})
 submit(@Body() body:unknown){return this.objects.submit(serviceRequestSchema.parse(body));}
 @Post('orders/:id/service-requests/:requestId/decision') @HttpCode(200)
 decide(@Req() r:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Param('requestId',ParseUUIDPipe) requestId:string,@Body() body:unknown){return this.objects.decide(r.user,id,requestId,serviceDecisionSchema.parse(body));}
}
