"""Complete SR-03 testnet deployment after a human funds an ephemeral wallet.

The workflow creates the wallet and stores its private key only in a mode-0600 file
under RUNNER_TEMP. This script reads that file, waits for public Arc testnet funds,
deploys the reviewed contract, executes one 0.01 testnet USDC payment through the
real browser application, and writes public evidence. It never connects to mainnet.
"""
from __future__ import annotations

import csv
import io
import json
import os
import re
import subprocess
import time
import urllib.error
import urllib.request
from hashlib import sha256
from pathlib import Path
from typing import Any

from eth_account import Account
from eth_utils import to_checksum_address
from playwright.sync_api import BrowserContext, Page, sync_playwright

CHAIN_ID = 5_042_002
RPC_URL = "https://rpc.testnet.arc.network"
EXPLORER_URL = "https://explorer.testnet.arc.io"
BASE_URL = "http://127.0.0.1:4173/"
WALLET_FILE = Path(os.environ["SETTLEREF_WALLET_FILE"])
FUNDING_TIMEOUT = int(os.environ.get("SETTLEREF_FUNDING_TIMEOUT", "1200"))
ARTIFACT = Path("out/SettleRef.sol/SettleRef.json")
DIST_CONFIG = Path("dist/deployment.json")
OUT = Path("evidence/sr03/testnet-live")
DOWNLOADS = OUT / "downloads"
OUT.mkdir(parents=True, exist_ok=True)
DOWNLOADS.mkdir(parents=True, exist_ok=True)

checks: list[dict[str, str]] = []
browser_errors: list[str] = []
report: dict[str, Any] = {
    "schema": "settleref.sr03-funded-testnet-evidence.v1",
    "generatedAt": int(time.time()),
    "sourceCommit": os.environ.get("GITHUB_SHA"),
    "runId": os.environ.get("GITHUB_RUN_ID"),
    "status": "RUNNING",
    "stage": "initializing",
    "network": {
        "chainId": CHAIN_ID,
        "rpcUrl": RPC_URL,
        "explorerUrl": EXPLORER_URL,
    },
    "safety": {
        "wallet": "fresh ephemeral CI wallet funded by a human testnet faucet claim",
        "privateKeyPersistedOutsideRunnerTemp": False,
        "privateKeyLogged": False,
        "customerFunds": False,
        "mainnetConnected": False,
        "mainnetTransaction": False,
    },
    "checks": checks,
}


def save_report() -> None:
    report["generatedAt"] = int(time.time())
    report["checks"] = checks
    report["screenshots"] = sorted(path.name for path in OUT.glob("*.png"))
    report["downloads"] = sorted(path.name for path in DOWNLOADS.glob("*"))
    (OUT / "testnet-live-evidence.json").write_text(
        json.dumps(report, indent=2) + "\n"
    )


def pass_check(name: str, detail: str) -> None:
    checks.append({"name": name, "detail": detail})
    save_report()


def rpc_call(method: str, params: list[Any], timeout: int = 20) -> Any:
    payload = json.dumps(
        {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    ).encode()
    request = urllib.request.Request(
        RPC_URL,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 SettleRef-SR03/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = json.loads(response.read())
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")[:400]
        raise RuntimeError(f"RPC {method} returned HTTP {error.code}: {detail}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"RPC {method} failed: {error}") from error
    if "error" in body:
        raise RuntimeError(f"RPC {method} rejected the request: {body['error']}")
    if "result" not in body:
        raise RuntimeError(f"RPC {method} returned no result")
    return body["result"]


def quantity(value: Any) -> int:
    if not isinstance(value, str) or not re.fullmatch(r"0x[0-9a-fA-F]+", value):
        raise RuntimeError(f"Malformed RPC quantity: {value!r}")
    return int(value, 16)


def balance(address: str) -> int:
    return quantity(rpc_call("eth_getBalance", [address, "latest"]))


def wait_for_funding(address: str) -> int:
    deadline = time.time() + FUNDING_TIMEOUT
    last = 0
    while time.time() < deadline:
        last = balance(address)
        report["funding"] = {
            "address": address,
            "requiredMinimumWei": "1000000000000000000",
            "observedBalanceWei": str(last),
            "deadlineEpoch": int(deadline),
        }
        save_report()
        if last >= 1_000_000_000_000_000_000:
            return last
        time.sleep(3)
    return last


def wait_for_receipt(tx_hash: str, timeout_seconds: int = 120) -> dict[str, Any]:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        receipt = rpc_call("eth_getTransactionReceipt", [tx_hash])
        if isinstance(receipt, dict):
            return receipt
        time.sleep(0.75)
    raise RuntimeError(f"Receipt did not appear for {tx_hash}")


def redact(text: str, private_key: str) -> str:
    return text.replace(private_key, "[REDACTED_PRIVATE_KEY]").replace(
        private_key.removeprefix("0x"), "[REDACTED_PRIVATE_KEY]"
    )


def parse_deployment(stdout: str) -> tuple[str, str]:
    clean = re.sub(r"\x1b\[[0-9;]*m", "", stdout)
    candidates = [clean.strip()]
    first = clean.find("{")
    last = clean.rfind("}")
    if first >= 0 and last > first:
        candidates.append(clean[first : last + 1])
    for candidate in candidates:
        try:
            value = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            address = value.get("deployedTo") or value.get("deployed_to")
            tx_hash = value.get("transactionHash") or value.get("transaction_hash")
            if isinstance(address, str) and isinstance(tx_hash, str):
                return address.lower(), tx_hash.lower()
    address_match = re.search(r"deployedTo[\"' :=]+(0x[0-9a-fA-F]{40})", clean)
    tx_match = re.search(r"transactionHash[\"' :=]+(0x[0-9a-fA-F]{64})", clean)
    if address_match and tx_match:
        return address_match.group(1).lower(), tx_match.group(1).lower()
    raise RuntimeError(f"Could not parse deployment output: {clean[-1600:]}")


def deploy_contract(private_key: str) -> tuple[str, str, dict[str, Any]]:
    completed = subprocess.run(
        [
            "arc-forge",
            "create",
            "contracts/SettleRef.sol:SettleRef",
            "--rpc-url",
            RPC_URL,
            "--chain",
            str(CHAIN_ID),
            "--private-key",
            private_key,
            "--broadcast",
            "--json",
        ],
        env={**os.environ, "FOUNDRY_PROFILE": "arc"},
        text=True,
        capture_output=True,
        timeout=240,
        check=False,
    )
    stdout = redact(completed.stdout, private_key)
    stderr = redact(completed.stderr, private_key)
    if completed.returncode != 0:
        raise RuntimeError(
            "Arc Foundry deployment failed. stdout="
            + stdout[-1800:]
            + " stderr="
            + stderr[-1800:]
        )
    contract, tx_hash = parse_deployment(completed.stdout)
    return contract, tx_hash, {
        "returnCode": completed.returncode,
        "stdoutTail": stdout[-1400:],
        "stderrTail": stderr[-1400:],
    }


def verify_runtime(contract: str) -> tuple[str, int]:
    artifact = json.loads(ARTIFACT.read_text())
    expected = artifact["deployedBytecode"]["object"].lower()
    if not expected.startswith("0x"):
        expected = "0x" + expected
    remote = rpc_call("eth_getCode", [contract, "latest"])
    if not isinstance(remote, str) or remote.lower() != expected:
        raise RuntimeError("Testnet runtime differs from the reviewed artifact")
    normalized = remote.lower()
    return "0x" + sha256(normalized.encode()).hexdigest(), (len(normalized) - 2) // 2


def write_live_config(contract: str, code_hash: str) -> None:
    DIST_CONFIG.write_text(
        json.dumps(
            {
                "chainId": CHAIN_ID,
                "rpcUrl": RPC_URL,
                "explorerUrl": EXPLORER_URL,
                "contractAddress": contract,
                "runtimeCodeSha256": code_hash,
                "writesEnabled": True,
            },
            indent=2,
        )
        + "\n"
    )


def add_error_capture(page: Page, label: str) -> None:
    page.on("pageerror", lambda error: browser_errors.append(f"{label}: pageerror: {error}"))

    def on_console(message: Any) -> None:
        if message.type == "error":
            browser_errors.append(f"{label}: console: {message.text}")

    page.on("console", on_console)


def wait_status(page: Page, fragment: str, timeout: int = 90_000) -> None:
    try:
        page.wait_for_function(
            "fragment => document.querySelector('#status').textContent.includes(fragment)",
            arg=fragment,
            timeout=timeout,
        )
    except Exception as error:
        current = page.locator("#status").inner_text()
        raise AssertionError(
            f"Status never contained {fragment!r}; current status was {current!r}"
        ) from error


def attach_wallet(page: Page, private_key: str, account: str, state: dict[str, Any]) -> None:
    def request(payload: dict[str, Any]) -> Any:
        method = payload.get("method")
        params = payload.get("params") or []
        if not isinstance(method, str) or not isinstance(params, list):
            raise RuntimeError("Malformed EIP-1193 request")
        state["requests"].append(method)
        if method in {"eth_accounts", "eth_requestAccounts"}:
            return [account]
        if method == "eth_sendTransaction":
            if len(params) != 1 or not isinstance(params[0], dict):
                raise RuntimeError("Wallet received malformed transaction parameters")
            tx = dict(params[0])
            if tx.get("from", "").lower() != account:
                raise RuntimeError("Wallet refused a transaction for another account")
            chain_id = quantity(rpc_call("eth_chainId", []))
            if quantity(tx.get("chainId", hex(chain_id))) != chain_id:
                raise RuntimeError("Wallet refused a transaction for another chain")
            nonce = quantity(
                rpc_call("eth_getTransactionCount", [account, "pending"])
            )
            signable = {
                "type": 2,
                "chainId": chain_id,
                "nonce": nonce,
                "to": to_checksum_address(tx["to"]),
                "value": quantity(tx.get("value", "0x0")),
                "data": tx.get("data", "0x"),
                "gas": quantity(tx["gas"]),
                "maxFeePerGas": quantity(tx["maxFeePerGas"]),
                "maxPriorityFeePerGas": quantity(tx["maxPriorityFeePerGas"]),
            }
            signed = Account.sign_transaction(signable, private_key)
            raw = getattr(
                signed, "raw_transaction", getattr(signed, "rawTransaction", None)
            )
            if raw is None:
                raise RuntimeError("Wallet could not obtain signed transaction bytes")
            raw_hex = raw.hex()
            if not raw_hex.startswith("0x"):
                raw_hex = "0x" + raw_hex
            tx_hash = rpc_call("eth_sendRawTransaction", [raw_hex])
            state["sendCount"] += 1
            state["transactionHashes"].append(tx_hash)
            return tx_hash
        return rpc_call(method, params)

    page.expose_function("__settlerefWalletRequest", request)
    page.add_init_script(
        """
        Object.defineProperty(window, 'ethereum', {
          configurable: false,
          enumerable: true,
          writable: false,
          value: Object.freeze({
            request: ({ method, params = [] }) => window.__settlerefWalletRequest({ method, params })
          })
        });
        """
    )


def new_page(
    context: BrowserContext,
    label: str,
    private_key: str | None = None,
    account: str | None = None,
    state: dict[str, Any] | None = None,
) -> Page:
    page = context.new_page()
    add_error_capture(page, label)
    if private_key and account and state is not None:
        attach_wallet(page, private_key, account, state)
    return page


def download(page: Page, name: str, target: Path) -> Path:
    with page.expect_download(timeout=30_000) as result:
        page.get_by_role("button", name=name, exact=True).click()
    result.value.save_as(str(target))
    return target


def run_browser(private_key: str, payer: str, beneficiary: str, contract: str) -> dict[str, Any]:
    state: dict[str, Any] = {
        "requests": [],
        "sendCount": 0,
        "transactionHashes": [],
    }
    server_log = OUT / "server.log"
    with server_log.open("w") as log:
        server = subprocess.Popen(
            ["node", "scripts/serve.mjs"],
            stdout=log,
            stderr=subprocess.STDOUT,
            text=True,
        )
    try:
        deadline = time.time() + 20
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(BASE_URL, timeout=2) as response:
                    if response.status == 200:
                        break
            except Exception:
                time.sleep(0.25)
        else:
            raise RuntimeError("Local application server did not become ready")

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            context = browser.new_context(
                viewport={"width": 1440, "height": 1100}, accept_downloads=True
            )
            page = new_page(
                context, "testnet-payment", private_key, payer, state
            )
            page.goto(BASE_URL, wait_until="networkidle", timeout=60_000)
            assert "Arc testnet" in page.locator("#network-chip").inner_text()
            assert "Configured" in page.locator("#network-chip").inner_text()
            page.get_by_role("button", name="Arc payment", exact=True).click()
            page.get_by_role("button", name="Load example").click()
            page.locator("#payer").fill(payer)
            page.locator("#beneficiary").fill(beneficiary)
            page.locator("#reference").fill("SR03-ARC-TESTNET")
            page.locator("#amount").fill("0.01")
            page.get_by_role("button", name="Review instruction").click()
            page.wait_for_function(
                "document.querySelector('#t-review').classList.contains('complete')"
            )
            identity = page.locator("#payment-summary dd").nth(3).inner_text()
            instruction_file = download(
                page,
                "Export instruction",
                DOWNLOADS / "testnet-instruction.json",
            )
            page.get_by_role("button", name="Connect wallet", exact=True).click()
            wait_status(page, "Connected")
            page.locator("#confirm").check()
            page.get_by_role("button", name="Sign and pay USDC").click()
            wait_status(page, "Transaction submitted")
            assert state["sendCount"] == 1
            tx_hash = page.locator("#tx-hash").input_value().lower()
            assert tx_hash == state["transactionHashes"][0].lower()
            page.screenshot(
                path=str(OUT / "01-testnet-transaction-submitted.png"),
                full_page=True,
            )

            receipt = wait_for_receipt(tx_hash)
            assert receipt.get("status") == "0x1"
            page.reload(wait_until="networkidle", timeout=60_000)
            assert page.locator("#tx-hash").input_value().lower() == tx_hash
            page.get_by_role("button", name="Arc payment", exact=True).click()
            page.get_by_role("button", name="Review instruction").click()
            page.wait_for_function(
                "document.querySelector('#t-review').classList.contains('complete')"
            )
            page.get_by_role("button", name="Verify receipt", exact=True).click()
            page.wait_for_function(
                "document.querySelector('#t-verify').classList.contains('complete')",
                timeout=90_000,
            )
            assert "Receipt reconciled against Arc RPC" in page.locator(
                "#receipt-result"
            ).inner_text()
            page.get_by_role("button", name="Test duplicate protection").click()
            wait_status(page, "Onchain settled flag is true")
            page.screenshot(
                path=str(OUT / "02-testnet-payment-verified.png"), full_page=True
            )

            receipt_file = download(
                page, "Download JSON receipt", DOWNLOADS / "testnet-receipt.json"
            )
            csv_file = download(
                page,
                "Download reconciliation CSV",
                DOWNLOADS / "testnet-reconciliation.csv",
            )
            bundle = json.loads(receipt_file.read_text())
            instruction = json.loads(instruction_file.read_text())
            assert bundle["schema"] == "settleref.bundle.v1"
            assert bundle["instruction"]["endToEndId"] == instruction["endToEndId"]
            assert bundle["receipt"]["instructionId"] == identity
            rows = list(csv.reader(io.StringIO(csv_file.read_text())))
            assert rows[1][8].lower() == tx_hash

            recipient = new_page(context, "independent-testnet-verification")
            recipient.goto(BASE_URL, wait_until="networkidle", timeout=60_000)
            recipient.locator("#receipt-file").set_input_files(str(receipt_file))
            wait_status(recipient, "Receipt bundle imported")
            recipient.get_by_role("button", name="Verify receipt", exact=True).click()
            recipient.wait_for_function(
                "document.querySelector('#t-verify').classList.contains('complete')",
                timeout=90_000,
            )
            assert "Receipt reconciled against Arc RPC" in recipient.locator(
                "#receipt-result"
            ).inner_text()
            recipient.screenshot(
                path=str(OUT / "03-independent-testnet-verification.png"),
                full_page=True,
            )
            context.close()
            browser.close()

        return {
            "payer": payer,
            "beneficiary": beneficiary,
            "contractAddress": contract,
            "amount": "0.010000",
            "transactionHash": tx_hash,
            "transactionExplorerUrl": f"{EXPLORER_URL}/tx/{tx_hash}",
            "blockNumber": quantity(receipt["blockNumber"]),
            "blockHash": receipt["blockHash"].lower(),
            "instructionId": identity,
            "walletRequests": state["requests"],
            "sendCount": state["sendCount"],
            "pendingRecovery": True,
            "duplicateFlagObserved": True,
            "independentBrowserVerification": True,
        }
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()


def main() -> None:
    wallet = json.loads(WALLET_FILE.read_text())
    private_key = wallet["privateKey"]
    payer = Account.from_key(private_key).address.lower()
    if payer != str(wallet["address"]).lower():
        raise RuntimeError("Wallet file address does not match its private key")
    beneficiary = Account.create(os.urandom(32)).address.lower()
    report["wallets"] = {
        "payer": payer,
        "beneficiary": beneficiary,
        "ephemeral": True,
    }

    report["stage"] = "network-preflight"
    chain_id = quantity(rpc_call("eth_chainId", []))
    if chain_id != CHAIN_ID:
        raise RuntimeError(f"RPC returned chain {chain_id}, expected {CHAIN_ID}")
    report["network"]["startingBlock"] = quantity(rpc_call("eth_blockNumber", []))
    pass_check("Arc testnet RPC matches chain 5042002", RPC_URL)

    report["stage"] = "awaiting-human-funding"
    funded_balance = wait_for_funding(payer)
    if funded_balance < 1_000_000_000_000_000_000:
        report["status"] = "BLOCKED_FUNDING_TIMEOUT"
        save_report()
        raise RuntimeError("The published ephemeral wallet was not funded before the bounded deadline")
    pass_check(
        "Human faucet claim funded the ephemeral testnet wallet",
        f"Balance reached {funded_balance} native USDC wei.",
    )

    report["stage"] = "deployment"
    contract, deployment_tx, forge = deploy_contract(private_key)
    deployment_receipt = wait_for_receipt(deployment_tx)
    if deployment_receipt.get("status") != "0x1":
        raise RuntimeError("Contract deployment transaction did not succeed")
    runtime_hash, runtime_bytes = verify_runtime(contract)
    report["deployment"] = {
        "deployer": payer,
        "contractAddress": contract,
        "transactionHash": deployment_tx,
        "transactionExplorerUrl": f"{EXPLORER_URL}/tx/{deployment_tx}",
        "contractExplorerUrl": f"{EXPLORER_URL}/address/{contract}",
        "blockNumber": quantity(deployment_receipt["blockNumber"]),
        "blockHash": deployment_receipt["blockHash"].lower(),
        "runtimeCodeSha256": runtime_hash,
        "runtimeBytes": runtime_bytes,
        "forge": forge,
    }
    pass_check(
        "Arc testnet runtime matches the reviewed artifact exactly",
        f"Contract {contract}, deployment transaction {deployment_tx}.",
    )

    report["stage"] = "browser-payment"
    write_live_config(contract, runtime_hash)
    payment = run_browser(private_key, payer, beneficiary, contract)
    report["payment"] = payment
    pass_check(
        "Real Arc testnet payment reconciles through the product UI",
        f"Transaction {payment['transactionHash']} settled 0.01 testnet USDC.",
    )
    pass_check(
        "Pending recovery, duplicate flag and second-browser verification pass",
        "The original identity survived reload and the exported bundle was independently reverified against RPC.",
    )
    if browser_errors:
        raise RuntimeError(f"Browser JavaScript errors: {browser_errors}")
    pass_check(
        "No browser JavaScript errors",
        "Deployment, payment, reload and independent verification completed without page or console errors.",
    )

    report["status"] = "PASS"
    report["stage"] = "complete"
    report["network"]["endingBlock"] = quantity(rpc_call("eth_blockNumber", []))
    report["safety"]["testnetTransactions"] = 2
    save_report()
    print(
        json.dumps(
            {
                "status": "PASS",
                "contractAddress": contract,
                "deploymentTransaction": deployment_tx,
                "paymentTransaction": payment["transactionHash"],
                "checks": len(checks),
            },
            indent=2,
        )
    )


try:
    main()
except Exception as error:
    if report.get("status") == "RUNNING":
        report["status"] = "FAIL"
    report["error"] = str(error)
    save_report()
    raise
