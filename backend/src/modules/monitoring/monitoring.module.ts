import {Module,Controller,Get,Req,Res,NotFoundException,ForbiddenException} from '@nestjs/common';
import type {FastifyRequest,FastifyReply} from 'fastify';
import {DatabaseModule} from '../../database/database.module';
import {MetricsService} from './metrics.service';

@Controller('ops')
class MetricsController {
  constructor(private readonly metrics:MetricsService){}
  @Get('metrics')
  async scrape(@Req() request:FastifyRequest,@Res() reply:FastifyReply) {
    if(!this.metrics.enabled)throw new NotFoundException();
    if(!this.metrics.authorized(request.headers.authorization))throw new ForbiddenException();
    return reply.type(this.metrics.registry.contentType).send(await this.metrics.registry.metrics());
  }
}
@Module({imports:[DatabaseModule],controllers:[MetricsController],providers:[MetricsService],exports:[MetricsService]})
export class MonitoringModule {}
