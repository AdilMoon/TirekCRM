import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { HttpException } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import type { FastifyRequest, FastifyReply } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { AppModule } from './app.module';
import { ApiErrors } from './common/api-errors.filter';
import { webOrigin } from './common/web-origin';
import { passwordResetDeliveryMode } from './auth/password-reset-delivery';
import { mailConfig } from './modules/mail/mail-config';
async function bootstrap() {
  webOrigin(); // Fail at startup instead of issuing cookies with invalid configuration.
  passwordResetDeliveryMode();
  mailConfig();
  if (process.env.NODE_ENV === 'production' && process.env.DEMO_SEED === 'true') throw new Error('Demo configuration must not run in production');
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ bodyLimit: 512 * 1024, trustProxy: false }));
  // Never let browsers or shared proxies retain tenant/session API responses,
  // including authentication errors and rate-limit responses.
  app.getHttpAdapter().getInstance().addHook('onRequest', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('Pragma', 'no-cache');
  });
  await app.register(cookie);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, {
    max: 300, timeWindow: '1 minute',
    // Nest's exception filter must preserve the plugin's rejection status and Retry-After headers.
    errorResponseBuilder: (_request, context) => new HttpException('Слишком много запросов. Попробуйте позже.', context.statusCode),
  });
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new ApiErrors());
  app.enableShutdownHooks();
  if (process.env.NODE_ENV !== 'production') {
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Tirek CRM API').setVersion('0.1.0').addCookieAuth('tirek_session').build());
    SwaggerModule.setup('api/docs', app, doc, { ui: false, jsonDocumentUrl: 'api/openapi.json' });
  }
  await app.listen(Number(process.env.API_PORT ?? 4000), process.env.API_HOST ?? '127.0.0.1');
}
bootstrap().catch(error => { console.error(error); process.exitCode = 1; });
