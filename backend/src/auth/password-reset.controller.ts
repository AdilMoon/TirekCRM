import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import { passwordResetRequestSchema, passwordResetConfirmSchema } from '@tirek/contracts';
import { PublicAccess } from './access';
import { SessionGuard } from './session.guard';
import { PasswordResetService } from './password-reset.service';

@Controller('auth/password-reset')
@UseGuards(SessionGuard)
@PublicAccess()
export class PasswordResetController {
  constructor(private readonly reset:PasswordResetService){}
  @Get('status') status(){return this.reset.status();}
  @Post('request') @HttpCode(202)
  @RouteConfig({rateLimit:{max:5,timeWindow:'1 minute'}})
  request(@Body() body:unknown){return this.reset.request(passwordResetRequestSchema.parse(body).email);}
  @Post('confirm') @HttpCode(200)
  @RouteConfig({rateLimit:{max:10,timeWindow:'1 minute'}})
  confirm(@Body() body:unknown){const input=passwordResetConfirmSchema.parse(body);return this.reset.confirm(input.token,input.newPassword);}
}
