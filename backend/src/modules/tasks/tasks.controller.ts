import { Controller, Get, Post, Patch, Header, Body, Req, Param, Query, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { taskSchema, updateTaskSchema, taskStatusSchema, taskQuerySchema, taskCommentSchema, taskCommentQuerySchema } from '@tirek/contracts';
import { AuthRequest, SessionGuard } from '../../auth/session.guard';
import { EmployeeAccess } from '../../auth/access';
import { TasksService } from './tasks.service';
import { TaskCommentsService } from './task-comments.service';
import { RouteConfig } from '@nestjs/platform-fastify';
@Controller('tasks')
@UseGuards(SessionGuard)
export class TasksController {
 constructor(private readonly tasks:TasksService,private readonly comments:TaskCommentsService){}
 @EmployeeAccess() @Get(':id/comments') @Header('Cache-Control','no-store')
 commentsList(@Req() req:AuthRequest,@Param('id',new ParseUUIDPipe()) id:string,@Query() query:unknown){
  return this.comments.list(req.user,id,taskCommentQuerySchema.parse(query));
 }
 @EmployeeAccess() @Post(':id/comments') @Header('Cache-Control','no-store')
 @RouteConfig({rateLimit:{max:30,timeWindow:'1 minute'}})
 comment(@Req() req:AuthRequest,@Param('id',new ParseUUIDPipe()) id:string,@Body() body:unknown){
  return this.comments.create(req.user,id,taskCommentSchema.parse(body));
 }
 @EmployeeAccess() @Get() list(@Req() req:AuthRequest,@Query() query:unknown){return this.tasks.list(req.user,taskQuerySchema.parse(query));}
 @EmployeeAccess() @Get(':id') get(@Req() req:AuthRequest,@Param('id',new ParseUUIDPipe()) id:string){return this.tasks.get(req.user,id);}
 @Post() create(@Req() req:AuthRequest,@Body() body:unknown){return this.tasks.create(req.user,taskSchema.parse(body));}
 @Patch(':id') update(@Req() req:AuthRequest,@Param('id',new ParseUUIDPipe()) id:string,@Body() body:unknown){return this.tasks.update(req.user,id,updateTaskSchema.parse(body));}
 @EmployeeAccess() @Patch(':id/status') status(@Req() req:AuthRequest,@Param('id',new ParseUUIDPipe()) id:string,@Body() body:unknown){const input=taskStatusSchema.parse(body);return this.tasks.status(req.user,id,input.status,input.version);}
}
