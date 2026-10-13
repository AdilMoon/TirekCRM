import { Body, Controller, Get, Header, Post, Query, Req, UseGuards } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import { notificationQuerySchema,readNotificationsSchema } from '@tirek/contracts';
import { EmployeeAccess } from '../../auth/access';
import { AuthRequest,SessionGuard } from '../../auth/session.guard';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(SessionGuard)
@EmployeeAccess()
export class NotificationsController {
 constructor(private readonly notifications:NotificationsService) {}
 @Get() @Header('Cache-Control','no-store')
 list(@Req() req:AuthRequest,@Query() query:unknown){return this.notifications.list(req.user,notificationQuerySchema.parse(query));}
 @Get('unread-count') @Header('Cache-Control','no-store')
 unread(@Req() req:AuthRequest){return this.notifications.unread(req.user);}
 @Post('read') @Header('Cache-Control','no-store')
 @RouteConfig({rateLimit:{max:60,timeWindow:'1 minute'}})
 read(@Req() req:AuthRequest,@Body() body:unknown){return this.notifications.read(req.user,readNotificationsSchema.parse(body).ids);}
}
