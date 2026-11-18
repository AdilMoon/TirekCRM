import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { materialListSchema, materialMoveSchema } from '@tirek/contracts';
import { SessionGuard, type AuthRequest } from '../../auth/session.guard';
import { MaterialsService } from './materials.service';

@Controller('finance/materials')
@UseGuards(SessionGuard)
export class MaterialsController {
  constructor(private readonly materials: MaterialsService) {}
  @Get()
  list(@Req() req: AuthRequest, @Query() query: unknown) {
    return this.materials.list(req.user.organizationId, materialListSchema.parse(query));
  }
  @Post(':id/movements')
  move(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.materials.move(req.user,id.toLowerCase(),materialMoveSchema.parse(body));
  }
}
