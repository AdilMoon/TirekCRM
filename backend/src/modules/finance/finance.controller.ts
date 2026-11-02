import 'reflect-metadata';
import {Controller,Get,Post,Body,Param,Req,UseGuards,ParseUUIDPipe} from '@nestjs/common';
import {refundSchema,expenseReversalSchema,expenseReplacementSchema} from '@tirek/contracts';
import {AuthRequest,SessionGuard} from '../../auth/session.guard';
import {FinanceService} from './finance.service';
@Controller('finance') @UseGuards(SessionGuard)
export class FinanceController {
 constructor(private readonly service:FinanceService){}
 @Get('payments/:id') payment(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.service.payment(req.user.organizationId,id.toLowerCase());}
 @Get('expenses/:id') expense(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.service.expense(req.user.organizationId,id.toLowerCase());}
 @Post('payments/:id/refunds') refund(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() body:unknown){return this.service.refund(req.user,id.toLowerCase(),refundSchema.parse(body));}
 @Post('expenses/:id/reversal') reverse(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() body:unknown){return this.service.reverse(req.user,id.toLowerCase(),expenseReversalSchema.parse(body));}
 @Post('expenses/:id/replacement') replace(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() body:unknown){return this.service.replace(req.user,id.toLowerCase(),expenseReplacementSchema.parse(body));}
}
