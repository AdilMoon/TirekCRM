import 'reflect-metadata';
import {Body,Controller,Get,Param,ParseUUIDPipe,Patch,Post,Query,Req,UseGuards} from '@nestjs/common';
import {privacyRequestSchema,privacyRequestQuerySchema,privacyRequestChangeSchema} from '@tirek/contracts';
import {AuthRequest,SessionGuard} from '../../auth/session.guard';
import {PrivacyRequestsService} from './privacy-requests.service';

@Controller('privacy-requests')
@UseGuards(SessionGuard)
export class PrivacyRequestsController {
 constructor(private readonly service:PrivacyRequestsService){}
 @Get() list(@Req() req:AuthRequest,@Query() query:unknown){return this.service.list(req.user.organizationId,privacyRequestQuerySchema.parse(query));}
 @Get(':id') get(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.service.get(req.user.organizationId,id.toLowerCase());}
 @Post() create(@Req() req:AuthRequest,@Body() body:unknown){return this.service.create(req.user,privacyRequestSchema.parse(body));}
 @Patch(':id') change(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() body:unknown){return this.service.change(req.user,id.toLowerCase(),privacyRequestChangeSchema.parse(body));}
}
