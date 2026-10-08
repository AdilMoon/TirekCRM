import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const compiled=ts.transpileModule(fs.readFileSync('frontend/i18n/format.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {formatDate,formatMoney}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
test('Kazakh dates use real month and weekday names',()=>{
 assert.equal(formatDate('kk','2026-10-07T12:00:00Z',{day:'numeric',month:'long',weekday:'long'}),'7 қазан, сәрсенбі');
 assert.equal(formatDate('kk','2026-10-07T12:00:00Z',{dateStyle:'long'}),'2026 ж. 7 қазан');
 assert.equal(formatDate('kk','2026-10-07T12:00:00Z',{month:'short'}),'қаз.');
});
test('date and currency presentation respects Almaty and fractional tiyn',()=>{
 assert.equal(formatDate('kk','2026-05-31T20:00:00Z'),'1 мау.');
 assert.match(formatDate('en','2026-05-31T20:00:00Z'),/1 Jun/);
 assert.match(formatMoney('kk','1000.25').replace(/\s/g,''),/^1000,25₸$/);
});

test('money display preserves exact tiyn beyond the safe Number range',()=>{
 for(const language of ['ru','kk','en']){
  const rendered=formatMoney(language,'180143985094819.82').replace(/[^0-9]/g,'');
  assert.equal(rendered,'18014398509481982',language);
  assert.equal(formatMoney(language,'9999999999999999.99').replace(/[^0-9]/g,''),'999999999999999999');
  assert.match(formatMoney(language,'-0.01'),/-/);
  assert.equal(formatMoney(language,'-0.01').replace(/[^0-9]/g,''),'001');
  assert.doesNotMatch(formatMoney(language,'-0.00'),/-/);
  assert.equal(formatMoney(language,'100.00').replace(/[^0-9]/g,''),'100');
 }
});
