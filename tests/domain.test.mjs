import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commitments, csvCell, makeExample, micros, nativeAmount, parseInstruction, assertPayable } from '../public/app/domain.js';

test('0.10 USDC uses exact 18-decimal native units', () => {
  assert.equal(nativeAmount(makeExample()), 100000000000000000n);
});
test('minimum unit and demo cap are exact', () => {
  assert.equal(micros('0.000001'), 1n);
  assert.equal(micros('1'), 1000000n);
});
for (const amount of ['1.000001', '0', '-1', '0.0000001', '1e-1', '0.1abc', '00.1', ' 0.1', 0.1]) {
  test(`rejects unsafe amount ${JSON.stringify(amount)}`, () => assert.throws(() => micros(amount)));
}
test('normalizes decimal representations without precision loss', () => {
  assert.equal(parseInstruction({ ...makeExample(), amount: '0.1' }).amount, '0.100000');
});
test('same reference identity survives amount, beneficiary and salt edits', async () => {
  const a = makeExample();
  const b = parseInstruction({ ...a, amount: '0.2', beneficiary: '0x3333333333333333333333333333333333333333', privacySalt: `0x${'ab'.repeat(32)}` });
  const ca = await commitments(a), cb = await commitments(b);
  assert.equal(ca.instructionId, cb.instructionId);
  assert.notEqual(ca.contentHash, cb.contentHash);
});
test('changing the chain changes the content commitment', async () => {
  const a = makeExample();
  assert.notEqual((await commitments(a)).contentHash, (await commitments({ ...a, chainId: 5042002 })).contentHash);
});
test('export and import retain identity and canonical commitments', async () => {
  const a = makeExample();
  assert.deepEqual(await commitments(a), await commitments(parseInstruction(JSON.parse(JSON.stringify(a)))));
});
for (const change of [{ chainId: 1 }, { payer: '0x0' }, { beneficiary: `0x${'0'.repeat(40)}` }, { asset: 'USD' }, { extra: true }, { reference: 'bad\nreference' }, { expiresAt: 1.5 }, { privacySalt: `0x${'0'.repeat(64)}` }]) {
  test(`rejects invalid instruction ${JSON.stringify(change)}`, () => assert.throws(() => parseInstruction({ ...makeExample(), ...change })));
}
test('rejects self payments', () => { const a = makeExample(); assert.throws(() => parseInstruction({ ...a, beneficiary: a.payer })); });
test('blocks expired instructions and unsafe sample addresses for live payments', () => {
  assert.throws(() => assertPayable(makeExample()));
  const a = parseInstruction({ ...makeExample(), payer: '0x3333333333333333333333333333333333333333', beneficiary: '0x4444444444444444444444444444444444444444' });
  assert.doesNotThrow(() => assertPayable(a));
  assert.throws(() => assertPayable(a, a.expiresAt));
});
test('CSV output escapes cells and blocks formula injection', () => {
  assert.equal(csvCell('=HYPERLINK("evil")'), '"\'=HYPERLINK(""evil"")"');
  assert.equal(csvCell('normal'), '"normal"');
  assert.equal(csvCell(' @SUM(1)'), '"\' @SUM(1)"');
});
