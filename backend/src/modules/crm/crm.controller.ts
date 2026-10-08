import 'reflect-metadata';

import { Controller, Get, Post, Patch, Body, Param, Query, Req, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { z } from 'zod';
import { clientSchema, organizationSchema, orderSchema, paymentSchema, expenseSchema, stages, listQuerySchema, orderQuerySchema, updateOrderSchema } from '@tirek/contracts';
import { Database } from '../../database/database.service';
import { AuthRequest, SessionGuard } from '../../auth/session.guard';
import { CrmService } from './crm.service';
import { SearchService } from './search.service';

@ApiTags('CRM')
@Controller()
@UseGuards(SessionGuard)
export class ApiController {
  constructor(private readonly db: Database, private readonly crm: CrmService, private readonly search:SearchService) {}
  @Get('dashboard') dashboard(@Req() req: AuthRequest) { return this.crm.dashboard(req.user.organizationId); }
  @Get('organization') organization(@Req() req: AuthRequest) { return this.db.client.organization.findUniqueOrThrow({ where: { id: req.user.organizationId }, select: { name: true, address: true, businessId: true } }); }
  @Patch('organization') updateOrganization(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.crm.updateOrganization(req.user.organizationId,organizationSchema.parse(body),req.user);
  }
  @Get('clients/search') searchClients(@Req() req:AuthRequest,@Query() query:unknown){return this.search.clients(req.user.organizationId,listQuerySchema.parse(query));}
  @Get('orders/search') searchOrders(@Req() req:AuthRequest,@Query() query:unknown){return this.search.orders(req.user.organizationId,orderQuerySchema.parse(query));}
  @Get('orders/:id') order(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.crm.order(req.user.organizationId,id);}
  @Patch('orders/:id') updateOrder(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() body:unknown){return this.crm.updateOrder(req.user.organizationId,id,updateOrderSchema.parse(body),req.user);}
  @Get('clients') clients(@Req() req: AuthRequest, @Query('q') query = '') { return this.crm.clients(req.user.organizationId, z.string().max(200).parse(query)); }
  @Post('clients') createClient(@Req() req: AuthRequest, @Body() body: unknown) { return this.crm.createClient(req.user.organizationId, clientSchema.parse(body), req.user); }
  @Patch('clients/:id') updateClient(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.crm.updateClient(req.user.organizationId, id, clientSchema.parse(body), req.user); }
  @Get('orders') orders(@Req() req: AuthRequest) { return this.crm.orders(req.user.organizationId); }
  @Post('orders') createOrder(@Req() req: AuthRequest, @Body() body: unknown) { return this.crm.createOrder(req.user.organizationId, orderSchema.parse(body), req.user); }
  @Patch('orders/:id/status') stage(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.crm.changeStage(req.user.organizationId, id, z.object({ status: z.enum(stages) }).parse(body).status, req.user); }
  @Post('orders/:id/payments') payment(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.crm.payment(req.user.organizationId, id, paymentSchema.parse(body), req.user); }
  @Post('expenses') expense(@Req() req: AuthRequest, @Body() body: unknown) { return this.crm.expense(req.user.organizationId, expenseSchema.parse(body), req.user); }
  @Get('movements') movements(@Req() req: AuthRequest) { return this.crm.movements(req.user.organizationId); }
  @Get('documents') documents(@Req() req: AuthRequest) { return this.crm.documents(req.user.organizationId); }
  @Get('documents/:id') document(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string) { return this.crm.document(req.user.organizationId, id); }
  @Post('orders/:id/documents') createDocument(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string) { return this.crm.createDocument(req.user.organizationId, id, req.user); }
}
