import { Catch, ExceptionFilter, ArgumentsHost, Logger, HttpException } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
@Catch()
export class ApiErrors implements ExceptionFilter {
  private readonly logger = new Logger('API');
  catch(error: unknown, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    if (error instanceof ZodError) { reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'Проверьте введённые данные' }); return; }
    if (error instanceof HttpException) { reply.status(error.getStatus()).send({ message: error.message }); return; }
    if(error instanceof Prisma.PrismaClientKnownRequestError && ['P2002','P2003','P2025'].includes(error.code)){
      reply.status(error.code==='P2025'?404:409).send({code:'DATA_CONFLICT',message:'Данные изменились. Обновите страницу и повторите действие'});return;
    }
    this.logger.error(error instanceof Error ? error.stack : 'Unexpected error');
    reply.status(500).send({ message: 'Не удалось выполнить операцию. Попробуйте ещё раз' });
  }
}
