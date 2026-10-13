"""Run the SR-03 Arc testnet deployment and browser smoke test.

This script generates an ephemeral wallet inside one CI job, requests public testnet
USDC through Circle's permissionless faucet, deploys the immutable SettleRef contract,
and executes the real browser flow against Arc testnet. The private keys never leave
process memory and are never written to evidence.

No Arc mainnet endpoint is used by this script.
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
from playwright.sync_api import BrowserContext, Page, expect, sync_playwright

CHAIN_ID = 5_042_002
RPC_URL = os.environ.get("SETTLEREF_TESTNET_RPC", "https://rpc.testnet.arc.network")
EXPLORER_URL = os.environ.get("SETTLEREF_TESTNET_EXPLORER", "https://explorer.testnet.arc.io")
FAUCET_URL = os.environ.get("SETTLEREF_TESTNET_FAUCET", "https://faucet.circle.com")
BASE_URL = os.environ.get("SETTLEREF_BASE_URL", "http://127.0.0.1:4173/")
ARTIFACT = Path("out/SettleRef.sol/SettleRef.json")
DIST_CONFIG = Path("dist/deployment.json")
OUT = Path("evidence/sr03/testnet")
DOWNLOADS = OUT / "downloads"
OUT.mkdir(parents=True, exist_ok=True)
DOWNLOADS.mkdir(parents=True, exist_ok=True)

checks: list[dict[str, str]] = []
browser_errors: list[str] = []
network_observations: list[dict[str, Any]] = []
report: dict[str, Any] = {
    "schema": "settleref.sr03-testnet-evidence.v1",
    "generatedAt": int(time.time()),
    "sourceCommit": os.environ.get("GITHUB_SHA"),
    "status": "RUNNING",
    "stage": "initializing",
    "network": {
        "chainId": CHAIN_ID,
        "rpcUrl": RPC_URL,
        "explorerUrl": EXPLORER_URL,
    },
    "safety": {
        "wallet": "fresh ephemeral CI wallet",
        "privateKeyPersisted": False,
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
    report["networkObservations"] = network_observations
    (OUT / "testnet-evidence.json").write_text(json.dumps(report, indent=2) + "\n")


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


def wait_for_balance(address: str, minimum: int, timeout_seconds: int = 150) -> int:
    deadline = time.time() + timeout_seconds
    current = 0
    while time.time() < deadline:
        current = balance(address)
        if current >= minimum:
            return current
        time.sleep(2)
    return current


def wait_for_receipt(tx_hash: str, timeout_seconds: int = 90) -> dict[str, Any]:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        value = rpc_call("eth_getTransactionReceipt", [tx_hash])
        if isinstance(value, dict):
            return value
        time.sleep(0.5)
    raise RuntimeError(f"Receipt did not appear for {tx_hash}")


def redact(text: str, private_keys: list[str]) -> str:
    safe = text
    for key in private_keys:
        safe = safe.replace(key, "[REDACTED_PRIVATE_KEY]")
        safe = safe.replace(key.removeprefix("0x"), "[REDACTED_PRIVATE_KEY]")
    return safe


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
    raise RuntimeError(f"Could not parse deployment output: {clean[-1200:]}")


def runtime_hash(code: str) -> str:
    normalized = code.lower()
    return "0x" + sha256(normalized.encode()).hexdigest()


def add_error_capture(page: Page, label: str) -> None:
    page.on("pageerror", lambda error: browser_errors.append(f"{label}: pageerror: {error}"))

    def on_console(message: Any) -> None:
        if message.type == "error":
            browser_errors.append(f"{label}: console: {message.text}")

    page.on("console", on_console)


def wait_status(page: Page, fragment: str, timeout: int = 45_000) -> None:
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


def wallet_state(private_key: str) -> dict[str, Any]:
    return {
        "private_key": private_key,
        "account": Account.from_key(private_key).address.lower(),
        "requests": [],
        "send_count": 0,
        "transaction_hashes": [],
    }


def attach_wallet(page: Page, state: dict[str, Any]) -> None:
    def request(payload: dict[str, Any]) -> Any:
        method = payload.get("method")
        params = payload.get("params") or []
        if not isinstance(method, str) or not isinstance(params, list):
            raise RuntimeError("Malformed EIP-1193 request")
        state["requests"].append(method)
        if method in {"eth_accounts", "eth_requestAccounts"}:
            return [state["account"]]
        if method == "eth_sendTransaction":
            if len(params) != 1 or not isinstance(params[0], dict):
                raise RuntimeError("Wallet received malformed transaction parameters")
            tx = dict(params[0])
            if tx.get("from", "").lower() != state["account"]:
                raise RuntimeError("Wallet refused a transaction for another account")
            chain_id = quantity(rpc_call("eth_chainId", []))
            requested_chain = quantity(tx.get("chainId", hex(chain_id)))
            if requested_chain != chain_id:
                raise RuntimeError("Wallet refused a transaction for another chain")
            nonce = quantity(
                rpc_call(
                    "eth_getTransactionCount", [state["account"], "pending"]
                )
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
            signed = Account.sign_transaction(signable, state["private_key"])
            raw = getattr(
                signed, "raw_transaction", getattr(signed, "rawTransaction", None)
            )
            if raw is None:
                raise RuntimeError("Wallet could not obtain signed transaction bytes")
            raw_hex = raw.hex()
            if not raw_hex.startswith("0x"):
                raw_hex = "0x" + raw_hex
            tx_hash = rpc_call("eth_sendRawTransaction", [raw_hex])
            state["send_count"] += 1
            state["transaction_hashes"].append(tx_hash)
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
    context: BrowserContext, label: str, state: dict[str, Any] | None = None
) -> Page:
    page = context.new_page()
    add_error_capture(page, label)
    if state is not None:
        attach_wallet(page, state)
    return page


def goto(page: Page) -> None:
    page.goto(BASE_URL, wait_until="networkidle", timeout=60_000)


def download(page: Page, button_name: str, target: Path) -> Path:
    with page.expect_download(timeout=30_000) as result:
        page.get_by_role("button", name=button_name, exact=True).click()
    result.value.save_as(str(target))
    return target


def request_faucet(payer: str) -> dict[str, Any]:
    observation: dict[str, Any] = {
        "url": FAUCET_URL,
        "requestedAddress": payer,
        "asset": "USDC",
        "network": "Arc Testnet",
    }
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 1100})
        page = context.new_page()
        responses: list[dict[str, Any]] = []

        def capture_response(response: Any) -> None:
            if "circle.com" in response.url:
                responses.append(
                    {
                        "url": response.url.split("?")[0],
                        "status": response.status,
                    }
                )

        page.on("response", capture_response)
        try:
            page.goto(FAUCET_URL, wait_until="domcontentloaded", timeout=90_000)
            page.screenshot(path=str(OUT / "01-faucet-loaded.png"), full_page=True)
            wallet_input = page.get_by_placeholder("Wallet address")
            wallet_input.wait_for(state="visible", timeout=45_000)
            wallet_input.fill(payer)
            button = page.get_by_role("button", name=re.compile(r"Send 20 USDC", re.I))
            button.wait_for(state="visible", timeout=45_000)
            expect(button).to_be_enabled(timeout=45_000)
            button.click(timeout=45_000)
            page.wait_for_timeout(7_000)
            page.screenshot(path=str(OUT / "02-faucet-requested.png"), full_page=True)
            body = page.locator("body").inner_text()
            relevant = [
                line.strip()
                for line in body.splitlines()
                if any(
                    token in line.lower()
                    for token in ["success", "sent", "limit", "error", "pending"]
                )
            ]
            observation["pageMessages"] = relevant[-12:]
            observation["clickCompleted"] = True
        except Exception as error:
            observation["clickCompleted"] = False
            observation["error"] = str(error)
            try:
                page.screenshot(path=str(OUT / "02-faucet-failure.png"), full_page=True)
            except Exception:
                pass
        finally:
            observation["circleResponses"] = responses[-20:]
            context.close()
            browser.close()
    return observation


def deploy_contract(private_key: str) -> tuple[str, str, dict[str, Any]]:
    env = os.environ.copy()
    env["FOUNDRY_PROFILE"] = "arc"
    command = [
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
    ]
    completed = subprocess.run(
        command,
        env=env,
        text=True,
        capture_output=True,
        timeout=180,
        check=False,
    )
    sanitized_stdout = redact(completed.stdout, [private_key])
    sanitized_stderr = redact(completed.stderr, [private_key])
    if completed.returncode != 0:
        raise RuntimeError(
            "Arc Foundry deployment failed. stdout="
            + sanitized_stdout[-1600:]
            + " stderr="
            + sanitized_stderr[-1600:]
        )
    contract, tx_hash = parse_deployment(completed.stdout)
    return contract, tx_hash, {
        "returnCode": completed.returncode,
        "stdoutTail": sanitized_stdout[-1200:],
        "stderrTail": sanitized_stderr[-1200:],
    }


def verify_runtime(contract: str) -> tuple[str, int]:
    artifact = json.loads(ARTIFACT.read_text())
    expected = artifact["deployedBytecode"]["object"].lower()
    if not expected.startswith("0x"):
        expected = "0x" + expected
    remote = rpc_call("eth_getCode", [contract, "latest"])
    if not isinstance(remote, str) or remote.lower() != expected:
        raise RuntimeError("Testnet runtime differs from the compiled artifact")
    return runtime_hash(remote), (len(remote) - 2) // 2


def write_live_config(contract: str, code_hash: str) -> None:
    config = {
        "chainId": CHAIN_ID,
        "rpcUrl": RPC_URL,
        "explorerUrl": EXPLORER_URL,
        "contractAddress": contract,
        "runtimeCodeSha256": code_hash,
        "writesEnabled": True,
    }
    DIST_CONFIG.write_text(json.dumps(config, indent=2) + "\n")


def run_browser_smoke(
    payer_private_key: str,
    beneficiary: str,
    contract: str,
) -> dict[str, Any]:
    state = wallet_state(payer_private_key)
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
            page = new_page(context, "arc-testnet-live", state)
            goto(page)
            assert "Arc testnet" in page.locator("#network-chip").inner_text()
            assert "Configured" in page.locator("#network-chip").inner_text()
            page.get_by_role("button", name="Arc payment", exact=True).click()
            page.get_by_role("button", name="Load example").click()
            page.locator("#payer").fill(state["account"])
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
            wait_status(page, "Transaction submitted", timeout=90_000)
            assert state["send_count"] == 1
            tx_hash = page.locator("#tx-hash").input_value().lower()
            assert tx_hash == state["transaction_hashes"][0].lower()
            page.screenshot(
                path=str(OUT / "03-testnet-transaction-submitted.png"),
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
            wait_status(page, "Onchain settled flag is true", timeout=45_000)
            page.screenshot(
                path=str(OUT / "04-testnet-payment-verified.png"), full_page=True
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

            recipient = new_page(context, "arc-testnet-independent-verification")
            goto(recipient)
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
                path=str(OUT / "05-testnet-independent-verification.png"),
                full_page=True,
            )
            context.close()
            browser.close()

        return {
            "payer": state["account"],
            "beneficiary": beneficiary,
            "contractAddress": contract,
            "amount": "0.010000",
            "transactionHash": tx_hash,
            "transactionExplorerUrl": f"{EXPLORER_URL}/tx/{tx_hash}",
            "blockNumber": quantity(receipt["blockNumber"]),
            "blockHash": receipt["blockHash"].lower(),
            "instructionId": identity,
            "walletRequests": state["requests"],
            "sendCount": state["send_count"],
            "pendingRecovery": True,
            "independentBrowserVerification": True,
            "duplicateFlagObserved": True,
        }
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()


def main() -> None:
    report["stage"] = "network-preflight"
    chain_id = quantity(rpc_call("eth_chainId", []))
    if chain_id != CHAIN_ID:
        raise RuntimeError(f"RPC returned chain {chain_id}, expected {CHAIN_ID}")
    report["network"]["startingBlock"] = quantity(rpc_call("eth_blockNumber", []))
    pass_check("Arc testnet RPC matches chain 5042002", RPC_URL)

    payer_account = Account.create(os.urandom(32))
    beneficiary_account = Account.create(os.urandom(32))
    payer_private_key = payer_account.key.hex()
    payer = payer_account.address.lower()
    beneficiary = beneficiary_account.address.lower()
    report["wallets"] = {
        "payer": payer,
        "beneficiary": beneficiary,
        "ephemeral": True,
    }
    save_report()

    report["stage"] = "faucet"
    faucet_observation = request_faucet(payer)
    report["faucet"] = faucet_observation
    funded_balance = wait_for_balance(payer, 1_000_000_000_000_000_000)
    report["faucet"]["balanceAfterRequest"] = str(funded_balance)
    if funded_balance < 1_000_000_000_000_000_000:
        report["status"] = "BLOCKED_FAUCET"
        report["stage"] = "faucet"
        save_report()
        raise RuntimeError(
            "Circle public faucet did not fund the fresh Arc testnet wallet within the bounded wait"
        )
    pass_check(
        "Fresh testnet wallet funded by the public faucet",
        f"Balance reached {funded_balance} native USDC units without owner or customer funds.",
    )

    report["stage"] = "deployment"
    contract, deploy_tx, forge_observation = deploy_contract(payer_private_key)
    deployment_receipt = wait_for_receipt(deploy_tx)
    if deployment_receipt.get("status") != "0x1":
        raise RuntimeError("Contract deployment transaction did not succeed")
    code_hash, runtime_bytes = verify_runtime(contract)
    report["deployment"] = {
        "deployer": payer,
        "contractAddress": contract,
        "transactionHash": deploy_tx,
        "transactionExplorerUrl": f"{EXPLORER_URL}/tx/{deploy_tx}",
        "contractExplorerUrl": f"{EXPLORER_URL}/address/{contract}",
        "blockNumber": quantity(deployment_receipt["blockNumber"]),
        "blockHash": deployment_receipt["blockHash"].lower(),
        "runtimeCodeSha256": code_hash,
        "runtimeBytes": runtime_bytes,
        "forge": forge_observation,
    }
    pass_check(
        "Arc testnet deployment runtime matches the reviewed artifact",
        f"Contract {contract} was deployed in transaction {deploy_tx} and matched byte-for-byte.",
    )

    report["stage"] = "browser-smoke"
    write_live_config(contract, code_hash)
    payment = run_browser_smoke(payer_private_key, beneficiary, contract)
    report["payment"] = payment
    pass_check(
        "Self-funded Arc testnet payment reconciles in the product UI",
        f"Transaction {payment['transactionHash']} settled 0.01 testnet USDC and RPC verification passed.",
    )
    pass_check(
        "Pending recovery, duplicate protection and second-browser verification pass",
        "The original identity survived reload, the onchain flag was true, and an independent browser reverified the bundle.",
    )

    if browser_errors:
        raise RuntimeError(f"Browser JavaScript errors: {browser_errors}")
    pass_check(
        "No browser JavaScript errors",
        "The real Arc testnet payment and independent verification completed without page or console errors.",
    )
    report["status"] = "PASS"
    report["stage"] = "complete"
    report["network"]["endingBlock"] = quantity(rpc_call("eth_blockNumber", []))
    report["safety"]["testnetTransactions"] = 2
    save_report()
    print(
        json.dumps(
            {
                "status": report["status"],
                "contractAddress": report["deployment"]["contractAddress"],
                "deploymentTransaction": report["deployment"]["transactionHash"],
                "paymentTransaction": report["payment"]["transactionHash"],
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
