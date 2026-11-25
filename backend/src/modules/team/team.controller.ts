import { Controller, Get, Post, Patch, Body, Req, Res, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import type {FastifyReply} from 'fastify';
import {setSessionCookie} from '../../auth/session';
import {cleanUserAgent} from '../../auth/auth.service';
import { RouteConfig } from '@nestjs/platform-fastify';
import { invitationSchema, invitationTokenSchema, acceptInvitationSchema, memberAccessSchema } from '@tirek/contracts';
import { AuthRequest, SessionGuard } from '../../auth/session.guard';
import { PublicAccess } from '../../auth/access';
import { TeamService } from './team.service';
@Controller('team')
@UseGuards(SessionGuard)
export class TeamController {
 constructor(private readonly team:TeamService) {}
 @Get() list(@Req() req:AuthRequest){return this.team.list(req.user.organizationId);}
 @Post('invitations') invite(@Req() req:AuthRequest,@Body() body:unknown){return this.team.invite(req.user,invitationSchema.parse(body));}
 @Post('invitations/:id/revoke') revoke(@Req() req:AuthRequest,@Param('id',new ParseUUIDPipe()) id:string){return this.team.revoke(req.user,id);}
 @Patch('members/:id') access(@Req() req:AuthRequest,@Param('id',new ParseUUIDPipe()) id:string,@Body() body:unknown){return this.team.access(req.user,id,memberAccessSchema.parse(body));}
 @PublicAccess()
 @Post('invitations/preview')
 @RouteConfig({rateLimit:{max:30,timeWindow:'1 minute'}})
 preview(@Body() body:unknown){return this.team.preview(invitationTokenSchema.parse(body).token);}
 @PublicAccess()
 @Post('invitations/accept')
 @RouteConfig({rateLimit:{max:10,timeWindow:'1 minute'}})
 async accept(@Body() body:unknown,@Req() req:AuthRequest,@Res({passthrough:true}) reply:FastifyReply){
  const input=acceptInvitationSchema.parse(body);
  const result=await this.team.accept(input.token,input.password,cleanUserAgent(req.headers['user-agent']),req.cookies?.tirek_session);
  setSessionCookie(reply,result.session);return {ok:true,email:result.email};
 }
}
