import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Logger,type ArgumentsHost} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {ApiErrors} from './api-errors.filter';

test('unexpected API errors log only correlation and safe classification',t=>{
 const messages:unknown[]=[];
 t.mock.method(Logger.prototype,'error',(...args:unknown[])=>messages.push(args));
 let status=0,body:Record<string,unknown>={};
 const reply={status:(value:number)=>{status=value;return reply;},send:(value:Record<string,unknown>)=>{body=value;}};
 const host={switchToHttp:()=>({getResponse:()=>reply})} as unknown as ArgumentsHost;
 const secret='private-customer-and-connection-password';
 for(const error of [new Error(secret),new Prisma.PrismaClientKnownRequestError(secret,{code:'P2010',clientVersion:'test',meta:{query:secret}}),{message:secret}]){
  new ApiErrors().catch(error,host);
  assert.equal(status,500);assert.match(String(body.errorId),/^[0-9a-f-]{36}$/);
  assert.equal(JSON.stringify(messages).includes(secret),false);
  assert.equal(JSON.stringify(body).includes(secret),false);
  assert.ok(JSON.stringify(messages).includes(String(body.errorId)));
 }
 assert.ok(JSON.stringify(messages).includes('P2010'));
});
