import { EmployeeAccess } from './access';
import { Controller,Get,Post,Delete,Body,Req,Res,Param,ParseUUIDPipe,UseGuards } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { loginSchema,passwordChangeSchema } from '@tirek/contracts';
import { Database } from '../database/database.service';
import { AuthRequest,SessionGuard,digest } from './session.guard';
import { AuthService,cleanUserAgent } from './auth.service';
function setSession(reply:FastifyReply,session:{token:string;expiresAt:Date}){
 reply.setCookie('tirek_session',session.token,{path:'/',httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',expires:session.expiresAt});
}
@ApiTags('Authentication')
@Controller('auth')
@UseGuards(SessionGuard)
export class AuthController {
 constructor(private readonly db:Database,private readonly auth:AuthService){}
 @Post('login')
 @RouteConfig({rateLimit:{max:10,timeWindow:'1 minute'}})
 async login(@Body() body:unknown,@Req() req:AuthRequest,@Res({passthrough:true}) reply:FastifyReply){
  const input=loginSchema.parse(body);
  setSession(reply,await this.auth.login(input.email,input.password,cleanUserAgent(req.headers['user-agent'])));
  return {ok:true};
 }
 @EmployeeAccess() @Post('logout')
 async logout(@Req() req:AuthRequest,@Res({passthrough:true}) reply:FastifyReply){
  await this.db.client.session.deleteMany({where:{tokenHash:digest(req.cookies.tirek_session!)}});
  reply.clearCookie('tirek_session',{path:'/'});return {ok:true};
 }
 @EmployeeAccess() @Get('me')
 async me(@Req() req:AuthRequest){
  const org=await this.db.client.organization.findUniqueOrThrow({where:{id:req.user.organizationId}});
  return {id:req.user.id,name:req.user.name,email:req.user.email,organization:{name:org.name,currency:org.currency},role:req.user.role};
 }
 @EmployeeAccess() @Get('sessions')
 sessions(@Req() req:AuthRequest){return this.auth.sessions(req.user,digest(req.cookies.tirek_session!));}
 @EmployeeAccess() @Post('password')
 @RouteConfig({rateLimit:{max:5,timeWindow:'1 minute'}})
 async password(@Req() req:AuthRequest,@Body() body:unknown,@Res({passthrough:true}) reply:FastifyReply){
  const input=passwordChangeSchema.parse(body);
  setSession(reply,await this.auth.changePassword(req.user,digest(req.cookies.tirek_session!),input.currentPassword,input.newPassword,cleanUserAgent(req.headers['user-agent'])));
  return {ok:true};
 }
 @EmployeeAccess() @Post('sessions/revoke-others')
 revokeOthers(@Req() req:AuthRequest){return this.auth.revokeOthers(req.user,digest(req.cookies.tirek_session!));}
 @EmployeeAccess() @Delete('sessions/:id')
 async revoke(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Res({passthrough:true}) reply:FastifyReply){
  const result=await this.auth.revoke(req.user,digest(req.cookies.tirek_session!),id);
  if(result.current)reply.clearCookie('tirek_session',{path:'/'});
  return result;
 }
}
