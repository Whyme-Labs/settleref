import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function run(expected) {
  const directory = await mkdtemp(join(tmpdir(), 'settleref-bash-'));
  try {
    const tools = {
      'mock-cast': '#!/bin/sh\ncase "$1" in\n chain-id) echo 5042002 ;;\n wallet) echo 0xAaBbCcDdEeFf0011223344556677889900112233 ;;\n balance) echo 1000000000000000000 ;;\n *) exit 1 ;;\nesac\n',
      'mock-forge': '#!/bin/sh\ncase "$1" in\n inspect) echo \'{"settle(bytes32,address,uint256,bytes32,uint64)":"355b5dd4","settled(address,bytes32)":"86efd7ea","MAX_PAYMENT()":"b1c1008c"}\' ;;\n create) echo \'{"mockDeployment":true}\' ;;\n test|build) exit 0 ;;\n *) exit 1 ;;\nesac\n',
      npm: '#!/bin/sh\nexit 0\n',
    };
    for (const [name, contents] of Object.entries(tools)) await writeFile(join(directory, name), contents, { mode: 0o700 });
    return execFileSync('/bin/bash', ['scripts/deploy.sh'], {
      encoding: 'utf8', stdio: 'pipe',
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, NETWORK: 'testnet',
        DEPLOYER_ACCOUNT: 'mock-owner', EXPECTED_DEPLOYER_ADDRESS: expected,
        FORGE_BIN: join(directory, 'mock-forge'), CAST_BIN: join(directory, 'mock-cast'), OUTPUT_DIR: directory },
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('macOS Bash accepts a matching owner address with different casing using mocked tools', async () => {
  const output = await run('0xaabbccddeeff0011223344556677889900112233');
  assert.match(output, /mockDeployment/);
});
test('macOS Bash rejects an unexpected owner before deployment using mocked tools', async () => {
  await assert.rejects(run('0x' + '99'.repeat(20)), error => {
    assert.match(error.stderr.toString(), /not EXPECTED_DEPLOYER_ADDRESS/);
    assert.doesNotMatch(error.stdout.toString(), /mockDeployment/);
    return true;
  });
});
