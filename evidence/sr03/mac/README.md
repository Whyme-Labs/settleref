# Mac continuation evidence

The source at `899f1e31986c618f3754cf58d9598a03effd586b` passed 66 Node tests, typecheck, production build, 18 standard EVM contract tests and 18 Arc Zero8 contract tests with 256 fuzz runs per profile. The ABI check passed. The two shell tests executed macOS Bash 3.2 with mocked deployment tools.

The real Chromium check deployed once on a local Arc Anvil chain through an injected EIP-1193 test provider backed by Anvil's local unlocked accounts. It verified creation calldata, zero deployment value, exact runtime and canonical block. Wrong-account and wrong-network states stopped before signing. Reload recovered the original hash and kept a second deployment disabled. The verified export and a 390 x 844 screenshot are included. This test made zero public-network transactions and is not Arc testnet evidence.

`owner-deployment-desktop.png` shows the actual Chrome operator page prepared for Arc testnet. MetaMask was detected, but no account was shared and the wallet was on Ethereum. No owner signature was requested.

Reproduce the operator check from a clean checkout using Arc Foundry and the Playwright CLI:

```sh
npm ci
bash scripts/install-arc-foundry.sh "$PWD/.tools/arc-foundry"
export PATH="$PWD/.tools/arc-foundry:$PATH"
npm run sr03:deploy:browser -- testnet
```

Run `node scripts/serve.mjs` and `arc-anvil --network arc --host 127.0.0.1 --port 18545 --silent` in separate terminals. Then run:

```sh
npx --yes --package @playwright/cli playwright-cli -s=settleref-local-check open http://127.0.0.1:4173/deploy/index.html --browser chrome
npx --yes --package @playwright/cli playwright-cli -s=settleref-local-check run-code --filename scripts/browser-deploy-check.js
npx --yes --package @playwright/cli playwright-cli -s=settleref-local-check close
```

Use the isolated CLI browser, not an existing wallet profile. The harness replaces configuration only in its browser's intercepted response and uses only the loopback local chain. It does not change the tracked deployment configuration. Its receipt export and screenshot replace local evidence files, so commit or discard those changes before preparing an owner deployment.

SR-03 remains `OWNER_ACTION_REQUIRED`. Mainnet preparation refuses to proceed without both explicit confirmation and matching independently verified testnet payment evidence.
