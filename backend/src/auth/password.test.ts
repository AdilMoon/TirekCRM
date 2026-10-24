import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hashPassword,verifyPassword} from './session.guard';
test('valid password roundtrip and wrong password rejection',async()=>{
 const stored=await hashPassword('Only a test password');
 assert.equal(await verifyPassword('Only a test password',stored),true);
 assert.equal(await verifyPassword('Different password',stored),false);
});
test('corrupt persisted hashes fail closed without throwing',async()=>{
 for(const stored of ['', 'unused', 'a'.repeat(32)+':'+ 'z'.repeat(128), 'a'.repeat(32)+':'+ '0'.repeat(126), 'a'.repeat(32)+':'+ '0'.repeat(128)+':extra', 'x'.repeat(32)+':'+ '0'.repeat(128)]){
  assert.equal(await verifyPassword('password',stored),false);
 }
});
