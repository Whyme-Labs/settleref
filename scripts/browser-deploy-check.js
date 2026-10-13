// Local Arc Anvil only. Run with playwright-cli run-code --filename in a fresh isolated browser session.
async (page) => {
  const rpcUrl = 'http://127.0.0.1:18545';
  const rpc = async (method, params = []) => {
    const response = await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const body = await response.json();
    if (body.error) throw new Error(body.error.message);
    return body.result;
  };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
  const local = await page.evaluate(async () => (await fetch('./config.json')).json());
  Object.assign(local, { network: 'local-arc-anvil', chainId: 31337, rpcUrl, explorerUrl: 'https://example.invalid' });
  await page.route('**/deploy/config.json', route => route.fulfill({ json: local }));
  const accounts = await rpc('eth_accounts');
  let account = accounts[0];
  let chain = 31337;
  let sends = 0;
  await page.exposeFunction('__localWalletRequest', async ({ method, params = [] }) => {
    if (['eth_accounts', 'eth_requestAccounts'].includes(method)) return [account];
    if (method === 'eth_chainId') return `0x${chain.toString(16)}`;
    if (method === 'eth_sendTransaction') {
      sends++;
      if (params[0].chainId !== '0x7a69' || params[0].value !== '0x0' || params[0].to !== undefined) throw new Error('Unexpected local deployment transaction');
    }
    return rpc(method, params);
  });
  await page.addInitScript(() => Object.defineProperty(window, 'ethereum', { value: { request: request => window.__localWalletRequest(request) } }));
  await page.reload();
  await page.getByLabel('Expected owner public address').fill(accounts[1]);
  await page.getByRole('button', { name: 'Connect wallet and review deployment' }).click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('does not match'));
  if (sends !== 0) throw new Error('Wrong account reached signing');
  await page.getByLabel('Expected owner public address').fill(accounts[0]);
  chain = 1;
  await page.getByRole('button', { name: 'Connect wallet and review deployment' }).click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Switch your wallet'));
  if (sends !== 0) throw new Error('Wrong chain reached signing');
  chain = 31337;
  await page.getByRole('button', { name: 'Connect wallet and review deployment' }).click();
  await page.waitForFunction(() => !document.querySelector('#deploy').disabled);
  await page.getByRole('button', { name: 'Approve one deployment in my wallet' }).click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Transaction submitted'));
  const transactionHash = await page.locator('#hash').inputValue();
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Recovered original transaction'));
  if (await page.locator('#hash').inputValue() !== transactionHash) throw new Error('Reload lost original hash');
  if (!(await page.locator('#deploy').isDisabled())) throw new Error('Reload enabled a second deployment');
  await page.getByRole('button', { name: 'Check deployment receipt' }).click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('"status": "PASS"'));
  const report = JSON.parse(await page.locator('#status').innerText());
  if (sends !== 1 || !report.exactRuntimeMatch || report.writesEnabled !== false) throw new Error('Deployment verification failed');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export verified deployment' }).click();
  await (await downloadPromise).saveAs('evidence/sr03/mac/local-deployment.json');
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (overflow || errors.length) throw new Error(`Browser errors: ${JSON.stringify({ overflow, errors })}`);
  await page.screenshot({ path: 'evidence/sr03/mac/local-deployment-mobile.png', fullPage: true });
  return { status: 'PASS', scope: 'local Arc Anvil only', sourceCommit: local.sourceCommit, chainId: 31337, sends, transactionHash, contractAddress: report.contractAddress, runtimeVerified: report.exactRuntimeMatch, pendingRecovered: true, wrongAccountRejected: true, wrongChainRejected: true, mobileOverflow: overflow, pageErrors: errors, publicNetworkTransactions: 0 };
}
