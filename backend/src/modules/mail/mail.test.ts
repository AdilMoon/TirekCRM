import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mailConfig } from './mail-config';
import { encryptReset,decryptReset } from './mail-queue';

test('mail configuration rejects unsafe local production and incomplete Gmail credentials',()=>{
  assert.equal(mailConfig({NODE_ENV:'production'}).mode,'disabled');
  assert.equal(mailConfig({NODE_ENV:'development'}).mode,'local');
  assert.throws(()=>mailConfig({NODE_ENV:'production',MAIL_DELIVERY:'local'}));
  assert.throws(()=>mailConfig({MAIL_DELIVERY:'smtp'}));
  const valid={MAIL_DELIVERY:'gmail',GMAIL_USER:'sender@example.com',GMAIL_APP_PASSWORD:'abcd efgh ijkl mnop',MAIL_ENCRYPTION_KEY:'01'.repeat(32)};
  assert.equal(mailConfig(valid).mode,'gmail');
  assert.throws(()=>mailConfig({...valid,NODE_ENV:'production',WEB_ORIGIN:'http://example.com'}));
  assert.equal(mailConfig({...valid,NODE_ENV:'production',WEB_ORIGIN:'https://example.com'}).mode,'gmail');
  for(const extra of [{GMAIL_USER:'bad'},{GMAIL_APP_PASSWORD:''},{MAIL_ENCRYPTION_KEY:''},{MAIL_ENCRYPTION_KEY:'ff'}])assert.throws(()=>mailConfig({...valid,...extra}));
});
test('encrypted reset mail binds ciphertext to its message and account',()=>{
  const token='a'.repeat(64),key=Buffer.alloc(32,7),payload=encryptReset(token,'message','user',key);
  assert.ok(!payload.includes(token));assert.equal(decryptReset(payload,'message','user',key),token);
  for(const [id,user,secret]of [['other','user',key],['message','other',key],['message','user',Buffer.alloc(32,8)]])assert.throws(()=>decryptReset(payload,id as string,user as string,secret as Buffer));
  assert.throws(()=>decryptReset('broken','message','user',key));
});
