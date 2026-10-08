import { Reflector } from '@nestjs/core';
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyRequest } from 'fastify';
import { Database } from '../database/database.service';

const scrypt = promisify(scryptCallback);
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash || hash.length !== 128) return false;
  const candidate = await scrypt(password, salt, 64) as Buffer;
  return timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export interface AuthRequest extends FastifyRequest {
  user: { id: string; organizationId: string; name: string; email: string; role: 'OWNER' | 'EMPLOYEE' };
}
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly db: Database, private readonly reflector:Reflector) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const path = req.url.split('?')[0];
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const allowed = new Set([process.env.WEB_ORIGIN ?? 'http://localhost:3000']);
      if (process.env.NODE_ENV !== 'production') allowed.add('http://127.0.0.1:3000');
      if (!req.headers.origin || !allowed.has(req.headers.origin)) throw new ForbiddenException('Недопустимый источник запроса');
    }
    if (this.reflector.getAllAndOverride<boolean>('publicAccess',[context.getHandler(),context.getClass()]) || path === '/api/health' || path === '/api/auth/login') return true;
    const token = req.cookies?.tirek_session;
    if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new UnauthorizedException('Войдите в систему');
    const session = await this.db.client.session.findUnique({ where: { tokenHash: digest(token) }, include: { user: true } });
    if (!session || !session.user.isActive || session.expiresAt <= new Date()) throw new UnauthorizedException('Сессия истекла. Войдите снова');
    if(session.user.role !== 'OWNER' && !this.reflector.getAllAndOverride<boolean>('employeeAccess',[context.getHandler(),context.getClass()])) throw new ForbiddenException('Недостаточно прав');
    req.user = session.user;
    return true;
  }
}
