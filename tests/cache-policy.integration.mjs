import 'dotenv/config';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const base=process.env.TEST_API_URL??'http://127.0.0.1:4000/api';
const origin=process.env.WEB_ORIGIN??'http://localhost:3000';
test('API responses including authentication and validation errors forbid caching',async()=>{
 for(const [path,options,status] of [
  ['/health',{},200],
  ['/auth/me',{},401],
  ['/team/invitations/preview',{method:'POST',headers:{Origin:'https://untrusted.invalid','Content-Type':'application/json'},body:'{}'},403],
  ['/team/invitations/preview',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'},400],
 ]){
  const response=await fetch(base+path,options);
  assert.equal(response.status,status,path);
  assert.equal(response.headers.get('cache-control'),'no-store',path);
  await response.arrayBuffer();
 }
});
