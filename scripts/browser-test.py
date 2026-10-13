"""SR-02 browser and wallet validation.

The workflow supplies three deployment configurations:
- an intentionally untrusted configuration,
- Arc testnet with writes disabled,
- a local Arc Anvil deployment with writes enabled.

The live local transaction uses a private-key-backed EIP-1193 development wallet.
No Arc mainnet transaction is submitted.
"""
from __future__ import annotations

import csv
import io
import json
import os
import shutil
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from eth_account import Account
from playwright.sync_api import BrowserContext, Page, sync_playwright

BASE_URL = os.environ.get("SETTLEREF_BASE_URL", "http://127.0.0.1:4173/")
DIST_CONFIG = Path(os.environ.get("SETTLEREF_DIST_CONFIG", "dist/deployment.json"))
LOCAL_CONFIG = Path(os.environ["SETTLEREF_LOCAL_CONFIG"])
TESTNET_CONFIG = Path(os.environ["SETTLEREF_TESTNET_CONFIG"])
UNTRUSTED_CONFIG = Path(os.environ["SETTLEREF_UNTRUSTED_CONFIG"])
LOCAL_RPC = os.environ.get("SETTLEREF_LOCAL_RPC", "http://127.0.0.1:8545")
TESTNET_RPC = os.environ.get("SETTLEREF_TESTNET_RPC", "https://rpc.testnet.arc.io")
PAYER_KEY = os.environ["SETTLEREF_PAYER_PRIVATE_KEY"]
BENEFICIARY = os.environ["SETTLEREF_BENEFICIARY"].lower()

OUT = Path("evidence/browser")
DOWNLOADS = OUT / "downloads"
OUT.mkdir(parents=True, exist_ok=True)
DOWNLOADS.mkdir(parents=True, exist_ok=True)

checks: list[dict[str, str]] = []
all_browser_errors: list[str] = []
observations: dict[str, Any] = {}


def pass_check(name: str, detail: str) -> None:
    checks.append({"name": name, "detail": detail})


def rpc_call(url: str, method: str, params: list[Any]) -> Any:
    payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    request = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            body = json.loads(response.read())
    except urllib.error.URLError as error:
        raise RuntimeError(f"RPC {method} failed at {url}: {error}") from error
    if "error" in body:
        raise RuntimeError(f"RPC {method} rejected the request: {body['error']}")
    if "result" not in body:
        raise RuntimeError(f"RPC {method} returned no result")
    return body["result"]


def set_deployment(path: Path) -> None:
    shutil.copyfile(path, DIST_CONFIG)


def wait_status(page: Page, fragment: str) -> None:
    page.wait_for_function(
        "fragment => document.querySelector('#status').textContent.includes(fragment)",
        fragment,
    )


def add_error_capture(page: Page, label: str) -> None:
    page.on("pageerror", lambda error: all_browser_errors.append(f"{label}: pageerror: {error}"))

    def on_console(message: Any) -> None:
        if message.type == "error":
            all_browser_errors.append(f"{label}: console: {message.text}")

    page.on("console", on_console)


def wallet_state(rpc_url: str, private_key: str = PAYER_KEY) -> dict[str, Any]:
    account = Account.from_key(private_key).address.lower()
    return {
        "rpc_url": rpc_url,
        "private_key": private_key,
        "account": account,
        "account_override": None,
        "chain_override": None,
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
        account = (state.get("account_override") or state["account"]).lower()
        if method in {"eth_accounts", "eth_requestAccounts"}:
            return [account]
        if method == "eth_chainId" and state.get("chain_override") is not None:
            return state["chain_override"]
        if method == "eth_sendTransaction":
            if len(params) != 1 or not isinstance(params[0], dict):
                raise RuntimeError("Wallet received malformed transaction parameters")
            tx = dict(params[0])
            if tx.get("from", "").lower() != state["account"]:
                raise RuntimeError("Wallet refused a transaction for another account")
            chain_id = int(rpc_call(state["rpc_url"], "eth_chainId", []), 16)
            requested_chain = int(tx.get("chainId", hex(chain_id)), 16)
            if requested_chain != chain_id:
                raise RuntimeError("Wallet refused a transaction for another chain")
            nonce = int(rpc_call(state["rpc_url"], "eth_getTransactionCount", [state["account"], "pending"]), 16)
            signable = {
                "type": 2,
                "chainId": chain_id,
                "nonce": nonce,
                "to": tx["to"],
                "value": int(tx.get("value", "0x0"), 16),
                "data": tx.get("data", "0x"),
                "gas": int(tx["gas"], 16),
                "maxFeePerGas": int(tx["maxFeePerGas"], 16),
                "maxPriorityFeePerGas": int(tx["maxPriorityFeePerGas"], 16),
            }
            signed = Account.sign_transaction(signable, state["private_key"])
            raw = getattr(signed, "raw_transaction", getattr(signed, "rawTransaction", None))
            if raw is None:
                raise RuntimeError("Wallet could not obtain signed transaction bytes")
            tx_hash = rpc_call(state["rpc_url"], "eth_sendRawTransaction", [f"0x{raw.hex()}"])
            state["send_count"] += 1
            state["transaction_hashes"].append(tx_hash)
            return tx_hash
        return rpc_call(state["rpc_url"], method, params)

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


def new_page(context: BrowserContext, label: str, state: dict[str, Any] | None = None) -> Page:
    page = context.new_page()
    add_error_capture(page, label)
    if state is not None:
        attach_wallet(page, state)
    return page


def goto(page: Page) -> None:
    page.goto(BASE_URL, wait_until="networkidle")


def download(page: Page, button_name: str, target: Path) -> Path:
    with page.expect_download() as result:
        page.get_by_role("button", name=button_name, exact=True).click()
    result.value.save_as(str(target))
    return target


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)

    # Untrusted configuration must fail closed before any wallet can send.
    set_deployment(UNTRUSTED_CONFIG)
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    page = new_page(context, "untrusted-config")
    goto(page)
    page.get_by_role("button", name="Arc payment", exact=True).click()
    page.wait_for_function("!document.querySelector('#deployment-notice').hidden")
    assert page.get_by_role("button", name="Sign and pay USDC").is_disabled()
    page.screenshot(path=str(OUT / "01-untrusted-config.png"), full_page=True)
    pass_check("Untrusted deployment fails closed", "Live payment remained disabled when writes lacked a pinned runtime hash.")
    context.close()

    # Connect a private-key-backed EIP-1193 wallet to the real Arc testnet RPC.
    set_deployment(TESTNET_CONFIG)
    testnet_chain = int(rpc_call(TESTNET_RPC, "eth_chainId", []), 16)
    assert testnet_chain == 5_042_002
    testnet_state = wallet_state(TESTNET_RPC)
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    page = new_page(context, "arc-testnet-wallet", testnet_state)
    goto(page)
    assert "Arc testnet" in page.locator("#network-chip").inner_text()
    page.get_by_role("button", name="Arc payment", exact=True).click()
    page.get_by_role("button", name="Connect wallet", exact=True).click()
    wait_status(page, "Connected")
    reported_chain = int(page.evaluate("window.ethereum.request({method: 'eth_chainId'})"), 16)
    assert reported_chain == testnet_chain
    assert page.get_by_role("button", name="Sign and pay USDC").is_disabled()
    assert "eth_requestAccounts" in testnet_state["requests"]
    page.screenshot(path=str(OUT / "02-arc-testnet-wallet.png"), full_page=True)
    observations["arcTestnet"] = {
        "rpc": TESTNET_RPC,
        "chainId": testnet_chain,
        "walletAddress": testnet_state["account"],
        "transactionSubmitted": False,
    }
    pass_check("EIP-1193 wallet connects to Arc testnet", "The wallet reported chain 5042002 from the live Arc testnet RPC; writes stayed disabled.")
    context.close()

    # Complete local simulation, import/export, XSS and precision checks in Chromium.
    set_deployment(TESTNET_CONFIG)
    context = browser.new_context(viewport={"width": 1440, "height": 1100}, accept_downloads=True)
    page = new_page(context, "demo-flow")
    goto(page)
    page.get_by_role("button", name="Load example").click()
    page.get_by_role("button", name="Review instruction").click()
    page.wait_for_function("document.querySelector('#t-review').classList.contains('complete')")
    assert page.get_by_role("button", name="Simulate settlement").is_disabled()
    demo_identity = page.locator("#payment-summary dd").nth(3).inner_text()
    instruction_file = download(page, "Download instruction", DOWNLOADS / "demo-instruction.json")
    page.screenshot(path=str(OUT / "03-desktop-review.png"), full_page=True)
    page.locator("#confirm").check()
    page.get_by_role("button", name="Simulate settlement").click()
    page.wait_for_function("document.querySelector('#t-settle').classList.contains('complete')")
    page.get_by_role("button", name="Test duplicate protection").click()
    wait_status(page, "Duplicate rejected by the local model")
    page.get_by_role("button", name="Verify receipt", exact=True).click()
    page.wait_for_function("document.querySelector('#t-verify').classList.contains('complete')")
    assert "Not onchain evidence" in page.locator("#receipt-result").inner_text()
    simulation_file = download(page, "Download JSON receipt", DOWNLOADS / "simulation-receipt.json")
    simulation = json.loads(simulation_file.read_text())
    assert simulation["schema"] == "settleref.simulation.v1"
    page.locator("#receipt-file").set_input_files(str(simulation_file))
    wait_status(page, "Simulations are not accepted")
    page.screenshot(path=str(OUT / "04-desktop-demo-complete.png"), full_page=True)
    pass_check("Local walkthrough completes in Chromium", "Explicit confirmation, one simulated settlement, duplicate rejection and simulation labelling all passed.")
    pass_check("Simulation cannot masquerade as a receipt", "The live receipt importer rejected the simulation schema.")

    imported = new_page(context, "instruction-round-trip")
    goto(imported)
    imported.locator("#instruction-file").set_input_files(str(instruction_file))
    wait_status(imported, "Instruction imported")
    imported.get_by_role("button", name="Review instruction").click()
    imported.wait_for_function("document.querySelector('#t-review').classList.contains('complete')")
    assert imported.locator("#payment-summary dd").nth(3).inner_text() == demo_identity
    pass_check("Instruction JSON round trip preserves identity", "Exporting, importing and reviewing produced the same instruction commitment.")

    xss = new_page(context, "xss-and-precision")
    goto(xss)
    xss.get_by_role("button", name="Load example").click()
    xss.locator("#reference").fill("<img src=x onerror=alert(1)>")
    xss.get_by_role("button", name="Review instruction").click()
    xss.wait_for_function("document.querySelector('#t-review').classList.contains('complete')")
    assert xss.locator("#payment-summary img").count() == 0
    assert "<img src=x onerror=alert(1)>" in xss.locator("#payment-summary").inner_text()
    xss.get_by_role("button", name="Load example").click()
    xss.locator("#amount").fill("0.0000001")
    xss.get_by_role("button", name="Review instruction").click()
    wait_status(xss, "6 decimal places")
    pass_check("Untrusted reference renders as text", "The browser created no image element or event handler from the supplied HTML string.")
    pass_check("Excess precision is rejected", "The UI rejected seven decimal places instead of rounding.")

    mobile = new_page(context, "mobile-layout")
    mobile.set_viewport_size({"width": 390, "height": 844})
    goto(mobile)
    mobile.get_by_role("button", name="Load example").click()
    mobile.get_by_role("button", name="Review instruction").click()
    mobile.wait_for_function("document.querySelector('#t-review').classList.contains('complete')")
    assert mobile.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    mobile.screenshot(path=str(OUT / "05-mobile-review.png"), full_page=True)
    pass_check("390 px layout has no horizontal overflow", "The document scroll width did not exceed the viewport.")
    context.close()

    # Execute the live flow on Arc Anvil through a private-key-backed EIP-1193 wallet.
    set_deployment(LOCAL_CONFIG)
    live_state = wallet_state(LOCAL_RPC)
    payer = live_state["account"]
    context = browser.new_context(viewport={"width": 1440, "height": 1100}, accept_downloads=True)
    page = new_page(context, "local-live-wallet", live_state)
    goto(page)
    assert "Local EVM" in page.locator("#network-chip").inner_text()
    page.get_by_role("button", name="Arc payment", exact=True).click()
    page.get_by_role("button", name="Load example").click()
    page.locator("#payer").fill(payer)
    page.locator("#beneficiary").fill(BENEFICIARY)
    page.locator("#reference").fill("=SUM(1,1)")
    page.locator("#amount").fill("0.10")
    page.get_by_role("button", name="Review instruction").click()
    page.wait_for_function("document.querySelector('#t-review').classList.contains('complete')")
    live_identity = page.locator("#payment-summary dd").nth(3).inner_text()
    live_instruction_file = download(page, "Download instruction", DOWNLOADS / "live-instruction.json")
    page.locator("#confirm").check()

    live_state["account_override"] = BENEFICIARY
    page.get_by_role("button", name="Sign and pay USDC").click()
    wait_status(page, "Connected wallet is not the instruction's payer")
    assert live_state["send_count"] == 0
    pass_check("Wrong wallet account is rejected before signing", "No eth_sendTransaction request occurred for the wrong account.")

    live_state["account_override"] = None
    live_state["chain_override"] = "0x1"
    page.get_by_role("button", name="Sign and pay USDC").click()
    wait_status(page, "Switch your wallet to the instruction's network")
    assert live_state["send_count"] == 0
    pass_check("Wrong wallet network is rejected before signing", "No transaction request occurred when the wallet reported chain 1.")

    live_state["chain_override"] = None
    page.get_by_role("button", name="Sign and pay USDC").click()
    wait_status(page, "Transaction submitted")
    assert live_state["send_count"] == 1
    tx_hash = page.locator("#tx-hash").input_value()
    assert tx_hash == live_state["transaction_hashes"][0]
    page.screenshot(path=str(OUT / "06-local-transaction-submitted.png"), full_page=True)

    page.reload(wait_until="networkidle")
    assert page.locator("#tx-hash").input_value() == tx_hash
    page.get_by_role("button", name="Arc payment", exact=True).click()
    assert page.locator("#tx-hash").input_value() == tx_hash
    page.get_by_role("button", name="Review instruction").click()
    page.wait_for_function("document.querySelector('#t-review').classList.contains('complete')")
    page.get_by_role("button", name="Verify receipt", exact=True).click()
    page.wait_for_function("document.querySelector('#t-verify').classList.contains('complete')")
    assert "Receipt reconciled against Arc RPC" in page.locator("#receipt-result").inner_text()
    page.get_by_role("button", name="Test duplicate protection").click()
    wait_status(page, "Onchain settled flag is true")
    page.screenshot(path=str(OUT / "07-local-payment-verified.png"), full_page=True)
    pass_check("Pending transaction survives reload", "The original transaction hash and instruction identity survived reload and mode switching.")
    pass_check("Private-key-backed EIP-1193 payment verifies", "One signed transaction settled on Arc Anvil and reconciled against the RPC receipt.")
    pass_check("Onchain duplicate protection is visible in the UI", "The settled mapping was true for the original payer and instruction identity.")

    receipt_file = download(page, "Download JSON receipt", DOWNLOADS / "live-receipt.json")
    csv_file = download(page, "Download reconciliation CSV", DOWNLOADS / "live-reconciliation.csv")
    receipt_bundle = json.loads(receipt_file.read_text())
    live_instruction = json.loads(live_instruction_file.read_text())
    assert receipt_bundle["schema"] == "settleref.bundle.v1"
    assert receipt_bundle["instruction"]["endToEndId"] == live_instruction["endToEndId"]
    assert receipt_bundle["receipt"]["instructionId"] == live_identity
    csv_rows = list(csv.reader(io.StringIO(csv_file.read_text())))
    assert csv_rows[1][1] == "'=SUM(1,1)"
    assert csv_rows[1][8] == tx_hash
    pass_check("Receipt JSON round trip preserves payment identity", "The bundle retained the original end-to-end ID and verified instruction commitment.")
    pass_check("CSV export is spreadsheet-safe", "A formula-prefixed reference was neutralized with a leading apostrophe.")

    recipient_page = new_page(context, "independent-receipt-verification")
    goto(recipient_page)
    recipient_page.locator("#receipt-file").set_input_files(str(receipt_file))
    wait_status(recipient_page, "Receipt bundle imported")
    assert recipient_page.locator("#payment-summary dd").nth(3).inner_text() == live_identity
    recipient_page.get_by_role("button", name="Verify receipt", exact=True).click()
    recipient_page.wait_for_function("document.querySelector('#t-verify').classList.contains('complete')")
    assert "Receipt reconciled against Arc RPC" in recipient_page.locator("#receipt-result").inner_text()
    recipient_page.screenshot(path=str(OUT / "08-independent-receipt-verification.png"), full_page=True)
    pass_check("A second browser independently verifies the receipt", "The imported bundle was rechecked against RPC; claimed receipt fields were not trusted.")

    observations["localArcExecution"] = {
        "chainId": int(rpc_call(LOCAL_RPC, "eth_chainId", []), 16),
        "payer": payer,
        "beneficiary": BENEFICIARY,
        "transactionHash": tx_hash,
        "walletRequests": live_state["requests"],
        "sendCount": live_state["send_count"],
        "mainnetTransaction": False,
    }
    context.close()
    browser.close()

assert not all_browser_errors, all_browser_errors
pass_check("No browser JavaScript errors", "All desktop, mobile, wallet and receipt-verification pages completed without page or console errors.")

report = {
    "schema": "settleref.browser-evidence.v1",
    "generatedAt": int(time.time()),
    "status": "PASS",
    "passed": len(checks),
    "failed": 0,
    "checks": checks,
    "observations": observations,
    "scope": {
        "browser": "Headless Chromium over the real HTTP application",
        "testnet": "Private-key-backed EIP-1193 provider connected to the live Arc testnet RPC; no transaction submitted",
        "liveTransaction": "Signed raw transaction on local Arc Anvil using Arc execution semantics",
        "mainnet": "No connection or transaction",
    },
    "screenshots": sorted(path.name for path in OUT.glob("*.png")),
    "downloads": sorted(path.name for path in DOWNLOADS.iterdir()),
}
(OUT / "browser-tests.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
