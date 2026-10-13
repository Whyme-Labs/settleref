# Deployment runbook

## Owner prerequisites

Create the public source repository, run CI and review its actual results. Mainnet deployment requires an owner-controlled funded Arc wallet and its local signing approval. No credentials are included in this package. Do not use publicly known development keys on Arc; some Arc test addresses are blocklisted.

Arc network documentation: https://docs.arc.io/arc/references/connect-to-arc
Arc Foundry source and releases: https://github.com/circlefin/arc-foundry
Arc runtime differences: https://docs.arc.io/arc/references/evm-differences

## Verification before real value

```sh
npm ci
npm test
bash scripts/install-arc-foundry.sh
npm run test:contracts
npm run test:contracts:arc
npm run check:abi
```

`npm run test:contracts` runs the Solidity suite under Arc Foundry's standard EVM profile. `npm run test:contracts:arc` repeats it with `network = "arc"`, which enables Arc execution semantics. Neither substitutes for a live Arc testnet smoke test. Check normal transfer, minimum precision, expiry, recipient revert, replay, USDC fee accounting and Arc-restricted recipient behavior.

## Testnet first

Use a locally encrypted keystore alias. The deployment script prompts through the installed tooling; it never needs a private key in a committed file.

```sh
DEPLOYER_ACCOUNT=your-local-alias NETWORK=testnet bash scripts/deploy.sh
node scripts/pin-deployment.mjs YOUR_DEPLOYED_ADDRESS 5042002
```

The pinning script compares remote runtime bytecode with the locally compiled artifact and leaves `writesEnabled` false. After independent review, set it true for the tiny self-funded smoke test, rebuild, and exercise the live UI. Record actual transaction receipts. Do not mark testnet checks passed based on local mocks.

## Mainnet

The owner explicitly enables the capped experiment:

```sh
DEPLOYER_ACCOUNT=your-local-alias NETWORK=mainnet \
CONFIRM_MAINNET=DEPLOY_CAPPED_EXPERIMENT bash scripts/deploy.sh
node scripts/pin-deployment.mjs YOUR_DEPLOYED_ADDRESS 5042
```

Inspect the deployment transaction and runtime. Enable writes only after the owner approves the precise deployment and risk. The 1-USDC contract cap is not an audit or a total-loss limit. Execute and verify one small self-funded payment and a duplicate rejection. Never ask an agent to invent a deployment address, transaction receipt or proof.

## Public app

`npm run build` produces `dist/` for static hosting, including Cloudflare Workers static assets. `wrangler.jsonc` is included. With your normal authenticated Wrangler installation, run `wrangler deploy`. No deploy was performed by this scaffold. Check that your chosen host applies the supplied security headers.

Changing the RPC requires updating both `deployment.json` and the CSP `connect-src`. A localhost EVM config is supported by the TypeScript parser for local tests, but the production CSP intentionally allows only Arc endpoints.

## Public repository

The repository is `https://github.com/Whyme-Labs/settleref`. It was created as private. The grant requires a public repository, so an organization owner must change visibility to public before submission. Open the URL in a signed-out browser afterward and confirm that the README, contract source, license and deployment evidence are visible.

## Submit

Populate `submission.json` with verified public links and actual evidence, then run `npm run check:submission`. Open every URL in a signed-out browser. Inspect the logged-in DoraHacks form for additional requirements. The local checker is not an organizer eligibility decision.
