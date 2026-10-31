import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const root=new URL('../',import.meta.url);
const read=async path=>readFile(new URL(path,root),'utf8');
const digest=text=>createHash('sha256').update(text).digest('hex');

test('Arc remains the default page and BOT uses an isolated route',async()=>{
 const [arc,bot,arcApp,botApp]=await Promise.all([
  read('public/index.html'),read('public/bot-testnet/index.html'),read('src/app.ts'),read('public/bot-testnet/app.mjs')
 ]);
 assert.match(arc,/href="\/bot-testnet\/" id="bot-link"/);
 assert.match(arc,/aria-current="page" href="\/"/);
 assert.match(bot,/aria-current="page" href="\/bot-testnet\/"/);
 assert.match(bot,/href="\.\/style\.css"/);
 assert.match(bot,/src="\.\/app\.mjs"/);
 assert.match(botApp,/fetch\('\.\/assets\.json'/);
 assert.doesNotMatch(botApp,/fetch\('\/assets\.json'/);
 assert.match(arcApp,/sessionStorage\.getItem\("settleref\.pending"\)/);
 assert.match(botApp,/\['requesting','unknown'\]/);
});

test('BOT source provenance distinguishes reviewed R5 files from the local runner delta; Arc write gate stays closed',async()=>{
 const provenance=JSON.parse(await read('evidence/bot-hosting-source.json'));
 for(const [name,expected] of Object.entries(provenance.unchangedBotFiles)){
  assert.equal(digest(await read('public/bot-testnet/'+name)),expected,name);
 }
 assert.equal(digest(await read('public/bot-testnet/'+provenance.postReviewLocalDelta.file)),provenance.postReviewLocalDelta.candidateSha256);
 assert.equal(digest(await read('tests/bot-runner.test.mjs')),provenance.postReviewLocalDelta.fakeProviderTestSha256);
 assert.notEqual(provenance.postReviewLocalDelta.reviewedR5Sha256,provenance.postReviewLocalDelta.candidateSha256);
 const arc=JSON.parse(await read('public/deployment.json'));
 const bot=JSON.parse(await read('public/bot-testnet/assets.json'));
 assert.equal(arc.chainId,5042);assert.equal(arc.writesEnabled,false);
 assert.equal(bot.chainId,968);
 assert.notEqual(bot.settlement.address,arc.contractAddress);
 assert.match(await read('public/_headers'),/script-src 'self'/);
 assert.doesNotMatch(await read('public/_headers'),/unsafe-inline|unsafe-eval/);
});
