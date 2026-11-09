import {Controller,UseGuards,Post,Get,Delete,Body,Param,Req,ParseUUIDPipe,HttpCode} from '@nestjs/common';
import {RouteConfig} from '@nestjs/platform-fastify';
import {messagePreviewSchema,messageOrderSchema,passportTokenSchema,passportConfirmSchema,passportPhotoSchema} from '@tirek/contracts';
import {SessionGuard,type AuthRequest} from '../../auth/session.guard';
import {PublicAccess,EmployeeAccess} from '../../auth/access';
import {MessageOrdersService} from './message-orders.service';
import {PassportService} from './passport.service';
@Controller() @UseGuards(SessionGuard)
export class SmartOrdersController {
 constructor(private readonly messages:MessageOrdersService,private readonly passports:PassportService){}
 @Post('message-orders/preview') @HttpCode(200) @RouteConfig({rateLimit:{max:15,timeWindow:'1 minute'}})
 preview(@Req() r:AuthRequest,@Body() body:unknown){return this.messages.preview(r.user.organizationId,messagePreviewSchema.parse(body).message);}
 @Post('message-orders') @RouteConfig({rateLimit:{max:10,timeWindow:'1 minute'}})
 create(@Req() r:AuthRequest,@Body() body:unknown){return this.messages.create(r.user,messageOrderSchema.parse(body));}
 @Get('orders/:id/passport') @EmployeeAccess()
 manage(@Req() r:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.passports.manage(r.user,id);}
 @Post('orders/:id/passport/link') @RouteConfig({rateLimit:{max:5,timeWindow:'1 minute'}})
 publish(@Req() r:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.passports.publish(r.user,id);}
 @Delete('orders/:id/passport/link')
 revoke(@Req() r:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.passports.revoke(r.user,id);}
 @Post('orders/:id/passport/photos') @EmployeeAccess() @RouteConfig({rateLimit:{max:10,timeWindow:'1 minute'}})
 photo(@Req() r:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() body:unknown){return this.passports.photo(r.user,id,passportPhotoSchema.parse(body));}
 @Delete('orders/:id/passport/photos/:photoId') @EmployeeAccess()
 deletePhoto(@Req() r:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Param('photoId',ParseUUIDPipe) photoId:string){return this.passports.deletePhoto(r.user,id,photoId);}
 @Post('passport/read') @PublicAccess() @HttpCode(200) @RouteConfig({rateLimit:{max:30,timeWindow:'1 minute'}})
 read(@Body() body:unknown){return this.passports.read(passportTokenSchema.parse(body).token);}
 @Post('passport/confirm') @PublicAccess() @HttpCode(200) @RouteConfig({rateLimit:{max:10,timeWindow:'1 minute'}})
 confirm(@Body() body:unknown){const v=passportConfirmSchema.parse(body);return this.passports.confirm(v.token,v.orderVersion,v.revision);}
}
