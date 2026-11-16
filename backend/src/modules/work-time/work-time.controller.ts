import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { workTimeDecisionSchema, workTimeEntrySchema, workTimeQuerySchema } from '@tirek/contracts';
import { EmployeeAccess } from '../../auth/access';
import { SessionGuard, type AuthRequest } from '../../auth/session.guard';
import { WorkTimeService } from './work-time.service';

@Controller('work-time')
@UseGuards(SessionGuard)
export class WorkTimeController {
  constructor(private readonly workTime: WorkTimeService) {}

  @Get()
  @EmployeeAccess()
  list(@Req() req: AuthRequest, @Query() query: unknown) {
    return this.workTime.list(req.user, workTimeQuerySchema.parse(query));
  }

  @Get('people')
  people(@Req() req: AuthRequest) {
    return this.workTime.people(req.user);
  }

  @Post()
  @EmployeeAccess()
  create(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.workTime.create(req.user, workTimeEntrySchema.parse(body));
  }

  @Patch(':id/decision')
  decide(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.workTime.decide(req.user, id, workTimeDecisionSchema.parse(body));
  }
}
