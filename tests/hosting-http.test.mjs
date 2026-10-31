import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, symlink, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHandler} from '../scripts/serve.mjs';

const root=fileURLToPath(new URL('../public/',import.meta.url));
const handle=createHandler(root);
async function request(url,method='GET',handler=handle){
 const result={status:null,headers:null,body:Buffer.alloc(0)};
 const response={
  writeHead(status,headers={}){result.status=status;result.headers=headers;},
  end(body){if(body!==undefined)result.body=Buffer.isBuffer(body)?body:Buffer.from(body);}
 };
 await handler({url,method},response);
 return result;
}

test('actual HTTP handler serves BOT index at canonical directory URL',async()=>{
 const redirect=await request('/bot-testnet?from=arc');
 assert.equal(redirect.status,308);
 assert.equal(redirect.headers.Location,'/bot-testnet/?from=arc');
 assert.equal(redirect.body.length,0);
 const page=await request('/bot-testnet/');
 assert.equal(page.status,200);
 assert.match(page.headers['Content-Type'],/^text\/html/);
 assert.match(page.body.toString(),/BOT testnet · native tBOT/);
 assert.deepEqual(page.body,(await request('/bot-testnet/index.html')).body);
 assert.deepEqual(page.body,(await request('/bot-testnet/?from=arc')).body);
});

test('directory indexes are canonical and symlinks cannot escape serving root',async()=>{
 const site=await mkdtemp(join(tmpdir(),'settleref-host-'));
 const external=await mkdtemp(join(tmpdir(),'settleref-outside-'));
 try {
  await mkdir(join(site,'nested'));
  await writeFile(join(site,'nested','index.html'),'nested ok');
  await writeFile(join(external,'secret.html'),'outside');
  await symlink(external,join(site,'escape'));
  const local=createHandler(site);
  assert.equal((await request('/nested?x=1','GET',local)).headers.Location,'/nested/?x=1');
  assert.equal((await request('/nested/','GET',local)).body.toString(),'nested ok');
  assert.equal((await request('/escape/secret.html','GET',local)).status,403);
 } finally { await rm(site,{recursive:true,force:true}); await rm(external,{recursive:true,force:true}); }
});

test('encoded separators and double encoding cannot produce a protocol-relative redirect',async()=>{
 for(const path of [
  '/%2fbot-testnet', '/%2Fbot-testnet', '/%5cbot-testnet',
  '/%252fbot-testnet', '/%255cbot-testnet',
  '/bot-testnet%2f', '//bot-testnet', '/%25252fbot-testnet'
 ]){
  const result=await request(path+'?next=example');
  assert.notEqual(result.status,308,path);
  assert.ok(result.status===400 || result.status===404,path);
  assert.ok(!result.headers?.Location?.startsWith('//'),path);
 }
 assert.equal((await request('/bot-testnet?next=example')).headers.Location,'/bot-testnet/?next=example');
});

test('BOT static modules, asset config and styles resolve inside their route',async()=>{
 for(const [path,type] of [
  ['/bot-testnet/app.mjs','text/javascript'],
  ['/bot-testnet/recovery-advice.mjs','text/javascript'],
  ['/bot-testnet/runner-core.mjs','text/javascript'],
  ['/bot-testnet/assets.json','application/json'],
  ['/bot-testnet/style.css','text/css']
 ]){
  const result=await request(path);
  assert.equal(result.status,200,path);
  assert.match(result.headers['Content-Type'],new RegExp('^'+type),path);
  assert.ok(result.body.length>0,path);
 }
 const app=(await request('/bot-testnet/app.mjs')).body.toString();
 assert.match(app,/fetch\('\.\/assets\.json'/);
});

test('Arc root remains available; HEAD, bad paths and non-read methods fail safely',async()=>{
 const arc=await request('/');
 assert.equal(arc.status,200);
 assert.match(arc.body.toString(),/Arc mainnet · native USDC/);
 assert.match(arc.body.toString(),/href="\/bot-testnet\/"/);
 const head=await request('/bot-testnet/','HEAD');
 assert.equal(head.status,200);assert.equal(head.body.length,0);
 assert.equal((await request('/bot-testnet/../../AGENTS.md')).status,404);
 assert.equal((await request('/%')).status,404);
 assert.equal((await request('/bot-testnet/','POST')).status,405);
});
