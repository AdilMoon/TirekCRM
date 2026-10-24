import 'reflect-metadata';
import {Body,Controller,Param,ParseUUIDPipe,Post,Req,UseGuards} from '@nestjs/common';
import {ApiTags} from '@nestjs/swagger';
import {annulDocumentSchema} from '@tirek/contracts';
import {SessionGuard,AuthRequest} from '../../auth/session.guard';
import {AnnulmentService} from './annulment.service';
@ApiTags('Documents')
@Controller('documents')
@UseGuards(SessionGuard)
export class AnnulmentController {
 constructor(private readonly service:AnnulmentService){}
 @Post(':id/annul')
 annul(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() body:unknown){
  return this.service.annul(req.user.organizationId,id.toLowerCase(),annulDocumentSchema.parse(body),req.user);
 }
}
