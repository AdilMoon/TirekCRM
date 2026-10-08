import { Controller, Get } from '@nestjs/common';
import { Database } from './database/database.service';
@Controller('health')
export class HealthController {
 constructor(private readonly db:Database) {}
 @Get() async health(){await this.db.client.$queryRaw`SELECT 1`;return {status:'ok',service:'tirek-api'};}
}
