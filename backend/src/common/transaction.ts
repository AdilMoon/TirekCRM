import { ConflictException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { setTimeout } from 'node:timers/promises';
export async function serializable<T>(db:PrismaClient, operation:(tx:Prisma.TransactionClient)=>Promise<T>):Promise<T> {
 for(let attempt=0; ; attempt++) {
  try { return await db.$transaction(operation,{isolationLevel:Prisma.TransactionIsolationLevel.Serializable}); }
  catch(error) {
   const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined;
   // PostgreSQL can reject COMMIT after the final query has already succeeded.
   const cause = error instanceof Error && error.name === 'DriverAdapterError' ? error.cause : null;
   const writeConflict = code === 'P2034' || (typeof cause === 'object' && cause !== null &&
     'kind' in cause && cause.kind === 'TransactionWriteConflict');
   if(writeConflict || code === 'P2002') {
    if(attempt<3){await setTimeout(15 * 2 ** attempt + Math.floor(Math.random()*15));continue;}
    if(writeConflict)throw new ConflictException('Данные изменяются одновременно. Обновите страницу и повторите действие');
   }
   throw error;
  }
 }
}
