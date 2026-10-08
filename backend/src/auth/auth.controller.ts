import { EmployeeAccess } from './access';
import { Controller, Get, Post, Body, Req, Res, UseGuards, UnauthorizedException } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { randomBytes } from 'node:crypto';
import { loginSchema } from '@tirek/contracts';
import { Database } from '../database/database.service';
import { AuthRequest, SessionGuard, digest, hashPassword, verifyPassword } from './session.guard';
@ApiTags('Authentication')
@Controller('auth')
@UseGuards(SessionGuard)
export class AuthController {
 private readonly dummyHash=hashPassword(randomBytes(32).toString('hex'));
 constructor(private readonly db:Database) {}
  @Post('login')
  @RouteConfig({ rateLimit: { max: 10, timeWindow: '1 minute' } })
  async login(@Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const input = loginSchema.parse(body);
    const user = await this.db.client.user.findUnique({ where: { email: input.email.toLowerCase().trim() } });
    const valid = await verifyPassword(input.password, user?.passwordHash ?? await this.dummyHash);
    if (!user || !user.isActive || !valid) throw new UnauthorizedException('Неверный email или пароль');
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 86400000);
    await this.db.client.session.create({ data: { tokenHash: digest(token), userId: user.id, expiresAt } });
    reply.setCookie('tirek_session', token, { path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', expires: expiresAt });
    return { ok: true };
  }
  @EmployeeAccess() @Post('logout') async logout(@Req() req: AuthRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.db.client.session.deleteMany({ where: { tokenHash: digest(req.cookies.tirek_session!) } });
    reply.clearCookie('tirek_session', { path: '/' }); return { ok: true };
  }
  @EmployeeAccess() @Get('me') async me(@Req() req: AuthRequest) {
    const org = await this.db.client.organization.findUniqueOrThrow({ where: { id: req.user.organizationId } });
    return { id:req.user.id, name: req.user.name, email: req.user.email, organization: { name: org.name, currency: org.currency }, role: req.user.role };
  }
}
