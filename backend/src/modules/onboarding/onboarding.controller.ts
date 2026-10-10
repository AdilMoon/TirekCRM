import { Body,Controller,Get,Header,Post,Req,Res,UseGuards } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { registrationSchema } from '@tirek/contracts';
import { PublicAccess } from '../../auth/access';
import { AuthRequest,SessionGuard,digest } from '../../auth/session.guard';
import { cleanUserAgent } from '../../auth/auth.service';
import { setSessionCookie } from '../../auth/session';
import { registrationEnabled } from './registration-config';
import { OnboardingService } from './onboarding.service';

@ApiTags('Onboarding')
@Controller('onboarding')
@UseGuards(SessionGuard)
export class OnboardingController {
 constructor(private readonly onboarding:OnboardingService){}
 @PublicAccess() @Get('status') @Header('Cache-Control','no-store')
 status(){return {registrationEnabled:registrationEnabled()};}
 @PublicAccess() @Post('register')
 @RouteConfig({rateLimit:{max:5,timeWindow:'1 minute'}})
 async register(@Body() body:unknown,@Req() req:AuthRequest,@Res({passthrough:true}) reply:FastifyReply){
  const input=registrationSchema.parse(body),token=req.cookies?.tirek_session;
  const tokenHash=token&&/^[a-f0-9]{64}$/.test(token)?digest(token):undefined;
  setSessionCookie(reply,await this.onboarding.register(input,cleanUserAgent(req.headers['user-agent']),tokenHash));
  return {ok:true};
 }
}
