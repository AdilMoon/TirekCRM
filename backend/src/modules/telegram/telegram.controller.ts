import {Controller,UseGuards,Get,Post,Delete,Body,Req,HttpCode} from '@nestjs/common';
import {RouteConfig} from '@nestjs/platform-fastify';
import {telegramPairSchema,telegramConfirmSchema} from '@tirek/contracts';
import {SessionGuard,type AuthRequest} from '../../auth/session.guard';
import {EmployeeAccess} from '../../auth/access';
import {TelegramService} from './telegram.service';
@Controller('telegram') @UseGuards(SessionGuard) @EmployeeAccess()
export class TelegramController {
 constructor(private readonly service:TelegramService){}
 @Get() status(@Req() r:AuthRequest){return this.service.status(r.user);}
 @Post('pair') @RouteConfig({rateLimit:{max:5,timeWindow:'1 minute'}})
 pair(@Req() r:AuthRequest,@Body() body:unknown){return this.service.pair(r.user,telegramPairSchema.parse(body).locale);}
 @Post('confirm') @HttpCode(200) @RouteConfig({rateLimit:{max:10,timeWindow:'1 minute'}})
 confirm(@Req() r:AuthRequest,@Body() body:unknown){const v=telegramConfirmSchema.parse(body);return this.service.confirm(r.user,v.pairingId,v.locale);}
 @Delete() disconnect(@Req() r:AuthRequest){return this.service.disconnect(r.user);}
}
