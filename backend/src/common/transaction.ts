import { ConflictException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { setTimeout } from 'node:timers/promises';
export async function serializable<T>(db:PrismaClient, operation:(tx:Prisma.TransactionClient)=>Promise<T>):Promise<T> {
 for(let attempt=0; ; attempt++) {
  try { return await db.$transaction(operation,{isolationLevel:Prisma.TransactionIsolationLevel.Serializable}); }
  catch(error) {
   if(error instanceof Prisma.PrismaClientKnownRequestError && ['P2034','P2002'].includes(error.code)) {
    if(attempt<3){await setTimeout(15 * 2 ** attempt + Math.floor(Math.random()*15));continue;}
    if(error.code==='P2034')throw new ConflictException('Данные изменяются одновременно. Обновите страницу и повторите действие');
   }
   throw error;
  }
 }
}
