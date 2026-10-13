import 'reflect-metadata';
import {Body,Controller,Param,ParseUUIDPipe,Post,Req,UseGuards} from '@nestjs/common';
import {ApiTags} from '@nestjs/swagger';
import {invoiceSchema} from '@tirek/contracts';
import {SessionGuard,AuthRequest} from '../../auth/session.guard';
import {InvoicesService} from './invoices.service';
@ApiTags('Documents')
@Controller('orders')
@UseGuards(SessionGuard)
export class InvoicesController {
 constructor(private readonly invoices:InvoicesService){}
 @Post(':id/invoices')
 create(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() body:unknown){
  return this.invoices.create(req.user.organizationId,id.toLowerCase(),invoiceSchema.parse(body),req.user);
 }
}
