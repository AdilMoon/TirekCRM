import {Controller,UseGuards,Get,Post,Patch,Req,Param,Body,ParseUUIDPipe,HttpCode} from '@nestjs/common';
import {RouteConfig} from '@nestjs/platform-fastify';
import {workProfileSchema,assignmentSlotSchema,assignOrderSchema,cancelAssignmentSchema} from '@tirek/contracts';
import {SessionGuard,type AuthRequest} from '../../auth/session.guard';
import {SchedulingService} from './scheduling.service';
@Controller() @UseGuards(SessionGuard)
export class SchedulingController {
 constructor(private readonly service:SchedulingService){}
 @Get('scheduling/members') members(@Req() r:AuthRequest){return this.service.members(r.user);}
 @Patch('scheduling/members/:id') profile(@Req() r:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() b:unknown){return this.service.profile(r.user,id,workProfileSchema.parse(b));}
 @Get('orders/:id/assignment') state(@Req() r:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.service.state(r.user,id);}
 @Post('orders/:id/assignment/recommendations') @HttpCode(200) @RouteConfig({rateLimit:{max:30,timeWindow:'1 minute'}})
 recommend(@Req() r:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() b:unknown){return this.service.recommend(r.user,id,assignmentSlotSchema.parse(b));}
 @Post('orders/:id/assignment') @RouteConfig({rateLimit:{max:20,timeWindow:'1 minute'}})
 assign(@Req() r:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() b:unknown){return this.service.assign(r.user,id,assignOrderSchema.parse(b));}
 @Post('orders/:id/assignment/cancel') @HttpCode(200)
 cancel(@Req() r:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() b:unknown){return this.service.cancel(r.user,id,cancelAssignmentSchema.parse(b).bookingId);}
}
