import {Body,Controller,Get,Param,ParseUUIDPipe,Patch,Post,Put,Req,UseGuards} from '@nestjs/common';
import {acceptanceCheckSchema,acceptanceConfigSchema,repeatVisitSchema} from '@tirek/contracts';
import {SessionGuard,type AuthRequest} from '../../auth/session.guard';
import {EmployeeAccess} from '../../auth/access';
import {OrderQualityService} from './order-quality.service';
@Controller('orders/:id')
@UseGuards(SessionGuard)
export class OrderQualityController {
  constructor(private readonly quality:OrderQualityService){}
  @EmployeeAccess() @Get('acceptance')
  read(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.quality.read(req.user,id.toLowerCase());}
  @Put('acceptance')
  configure(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() body:unknown){
    return this.quality.configure(req.user,id.toLowerCase(),acceptanceConfigSchema.parse(body));
  }
  @EmployeeAccess() @Patch('acceptance')
  check(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() body:unknown){
    return this.quality.check(req.user,id.toLowerCase(),acceptanceCheckSchema.parse(body));
  }
  @Post('repeat-visits')
  repeat(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() body:unknown){
    return this.quality.repeat(req.user,id.toLowerCase(),repeatVisitSchema.parse(body));
  }
}
