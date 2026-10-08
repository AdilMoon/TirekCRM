import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { auditQuerySchema } from '@tirek/contracts';
import { AuthRequest, SessionGuard } from '../../auth/session.guard';
import { AuditService } from './audit.service';
@ApiTags('Audit')
@Controller('audit')
@UseGuards(SessionGuard)
export class AuditController {
 constructor(private readonly audit:AuditService) {}
 @Get() list(@Req() req:AuthRequest,@Query() query:unknown){return this.audit.list(req.user.organizationId,auditQuerySchema.parse(query));}
}
