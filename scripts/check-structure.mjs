import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';
const root = process.cwd();
for(const dir of ['backend/src','backend/prisma','frontend/app','frontend/features','frontend/components','frontend/lib','frontend/i18n','packages/contracts','docs','scripts','tests']) assert.ok(fs.statSync(dir).isDirectory(), 'Missing directory: '+dir);
assert.ok(!fs.existsSync('apps'), 'Use backend/ and frontend/, not apps/');
function files(dir) { return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()&&!['node_modules','.next','dist'].includes(e.name)?files(path.join(dir,e.name)):e.isFile()&&/\.tsx?$/.test(e.name)?[path.join(dir,e.name)]:[]); }
const messages=JSON.parse(fs.readFileSync('frontend/i18n/messages.json','utf8'));
const placeholders=s=>[...s.matchAll(/\{\d+\}/g)].map(m=>m[0]).sort();
for(const [key,value] of Object.entries(messages)) for(const lang of ['kk','en']){
 assert.ok(value[lang]?.trim(),'Missing '+lang+': '+key);
 assert.deepEqual(placeholders(value[lang]),placeholders(key),'Placeholders: '+lang+' '+key);
}
for(const file of [...files('frontend'),...files('backend/src'),...files('packages/contracts')]) {
 const text=fs.readFileSync(file,'utf8');
 const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 function walk(n){
  if(ts.isImportDeclaration(n)&&ts.isStringLiteral(n.moduleSpecifier)){
   const resolved=path.resolve(path.dirname(file),n.moduleSpecifier.text);
   if(file.startsWith('frontend'))assert.ok(!resolved.startsWith(path.join(root,'backend')+path.sep),'Frontend may not import backend: '+file);
   if(file.startsWith('backend'))assert.ok(!resolved.startsWith(path.join(root,'frontend')+path.sep),'Backend may not import frontend: '+file);
   if(file.startsWith('packages'))assert.ok(!resolved.startsWith(path.join(root,'frontend')+path.sep)&&!resolved.startsWith(path.join(root,'backend')+path.sep),'Contracts may not import applications');
  }
  if(file.startsWith('frontend')&&!file.includes('i18n')){
   if(ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&n.expression.text==='t'&&ts.isStringLiteral(n.arguments[0]))assert.ok(messages[n.arguments[0].text],'Untranslated key in '+file+': '+n.arguments[0].text);
   if(ts.isJsxText(n))assert.ok(!/[А-Яа-яЁё]/.test(n.text),'Untranslated JSX in '+file+': '+n.text.trim());
   if(ts.isJsxAttribute(n)&&n.initializer&&ts.isStringLiteral(n.initializer))assert.ok(!/[А-Яа-яЁё]/.test(n.initializer.text),'Untranslated attribute in '+file);
  }
  ts.forEachChild(n,walk);
 }walk(source);
}
console.log('Structure, dependency boundaries and '+Object.keys(messages).length+' translation entries verified.');
