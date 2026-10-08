import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

export function createDb() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 10 }) });
}
@Injectable()
export class Database implements OnModuleDestroy {
  readonly client = createDb();
  async onModuleDestroy() { await this.client.$disconnect(); }
}
