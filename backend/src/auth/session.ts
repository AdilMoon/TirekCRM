import type { Prisma } from '@prisma/client';
import type { FastifyReply } from 'fastify';
import { randomBytes } from 'node:crypto';
import { digest } from './session.guard';

export async function createSession(tx:Prisma.TransactionClient,userId:string,userAgent:string){
 const token=randomBytes(32).toString('hex'),expiresAt=new Date(Date.now()+7*86400000);
 await tx.session.create({data:{tokenHash:digest(token),userId,expiresAt,userAgent}});
 return {token,expiresAt};
}
export function setSessionCookie(reply:FastifyReply,session:{token:string;expiresAt:Date}){
 reply.setCookie('tirek_session',session.token,{path:'/',httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',expires:session.expiresAt});
}
