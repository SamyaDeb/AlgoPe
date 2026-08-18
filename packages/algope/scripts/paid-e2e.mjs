#!/usr/bin/env node
/**
 * End-to-end paid-path verification.
 *
 * Drives real x402 payments through a real AlgoPe proxy and confirms each one
 * settled on Algorand testnet. Every request here moves real testnet USDC and
 * writes a transaction to the chain, so N is deliberately small.
 *
 * The payer key is read from the OS keychain via @algope/agent — the mnemonic
 * is never passed on the command line or written to disk.
 *
 * Usage:
 *   node scripts/paid-e2e.mjs --requests 5
 *   node scripts/paid-e2e.mjs --requests 5 --facilitator-mode self
 */

import http from "node:http";
import algosdk from "algosdk";

import { startProxyServer } from "../dist/index.js";
import { PaymentClient, getWalletMnemonic } from "../../algope-agent/dist/index.js";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const REQUESTS = Number(arg("requests", 5));
const FACILITATOR = arg("facilitator-mode", "goplausible");
const PRICE = arg("price", "0.001");
const BACKEND_PORT = Number(arg("backend-port", 3998));
const PROXY_PORT = Number(arg("proxy-port", 4998));

// Payer holds the key in the keychain; receiver must be opted in to USDC or the
// ASA transfer cannot land.
const PAYER = arg("payer", "HMPG7YLTESN4FQXIGCAHQOXDEIDUIFBOINJDGQ7WUFBTYMOIKDIN6CITPM");
const RECEIVER = arg("receiver", "CIQZP6I73Q5527QWZHZLZBIDSOHVV5LMP5IEQNQYVRXYOZTQSYB7X57PBE");

const USDC_TESTNET_ASA = 10458941;
const algod = new algosdk.Algodv2("", "https://testnet-api.algonode.cloud", "");

const PATHS = ["/weather", "/forecast", "/btc/price", "/crypto", "/news/top"];

function startBackend(port) {
  const server = http.createServer((req, res) => {
    const path = req.url.split("?")[0];
    res.setHeader("content-type", "application/json");
    if (!PATHS.includes(path)) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ error: "not found" }));
    }
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, path, served: Date.now() }));
  });
  return new Promise((r) => server.listen(port, () => r(server)));
}

async function usdcBalance(addr) {
  const info = await algod.accountInformation(addr).do();
  const a = (info.assets ?? []).find((x) => Number(x.assetId) === USDC_TESTNET_ASA);
  return a ? Number(a.amount) / 1e6 : 0;
}

// ---------------------------------------------------------------------------

const config = {
  serviceName: "Paid E2E Service",
  serviceDescription: "End-to-end settlement verification",
  tags: ["e2e"],
  targetUrl: `http://127.0.0.1:${BACKEND_PORT}`,
  pricePerRequest: PRICE,
  paymentToken: "USDC",
  walletAddress: RECEIVER,
  proxyPort: PROXY_PORT,
  network: "testnet",
  logLevel: "quiet",
  facilitatorMode: FACILITATOR,
};

console.log(`\nAlgoPe paid end-to-end verification`);
console.log(`  requests      ${REQUESTS}`);
console.log(`  price         ${PRICE} USDC each`);
console.log(`  payer         ${PAYER.slice(0, 12)}...`);
console.log(`  receiver      ${RECEIVER.slice(0, 12)}...`);

const backend = await startBackend(BACKEND_PORT);
const { server, facilitator } = await startProxyServer({ config });
console.log(`  facilitator   ${facilitator.description}`);
if (facilitator.fallbackReason) console.log(`  fallback      ${facilitator.fallbackReason}`);

const payerBefore = await usdcBalance(PAYER);
const recvBefore = await usdcBalance(RECEIVER);
console.log(`\n  payer USDC before     ${payerBefore.toFixed(6)}`);
console.log(`  receiver USDC before  ${recvBefore.toFixed(6)}`);

// Pull the signing key out of the OS keychain in-process. It is never printed,
// written to disk, or passed on the command line.
const secret = await getWalletMnemonic(PAYER);
if (!secret) {
  console.error(`\nNo key in the OS keychain for ${PAYER}. Run 'algope-agent init' first.\n`);
  server.close();
  backend.close();
  process.exit(2);
}

const client = new PaymentClient({ mnemonic: secret, network: "testnet" });

const results = [];
console.log(`\n  #   path          status  latency   txId`);
console.log(`  ${"-".repeat(64)}`);

for (let i = 0; i < REQUESTS; i++) {
  const path = PATHS[i % PATHS.length];
  const t0 = performance.now();
  try {
    const res = await client.fetch(`http://127.0.0.1:${PROXY_PORT}${path}`);
    const ms = performance.now() - t0;
    const txId = res.paymentReceipt?.txId ?? "";
    results.push({ ok: res.status === 200 && res.paid, txId, ms, status: res.status });
    console.log(
      `  ${String(i + 1).padEnd(3)} ${path.padEnd(13)} ${String(res.status).padEnd(7)} ` +
        `${ms.toFixed(0).padStart(5)}ms   ${txId.slice(0, 20)}${txId ? "..." : "(none)"}`
    );
  } catch (e) {
    const ms = performance.now() - t0;
    results.push({ ok: false, txId: "", ms, status: "ERR", error: String(e.message ?? e) });
    console.log(`  ${String(i + 1).padEnd(3)} ${path.padEnd(13)} ERR     ${ms.toFixed(0).padStart(5)}ms   ${String(e.message).slice(0, 40)}`);
  }
}

// ---------------------------------------------------------------------------
// Confirm settlement actually reached the chain
// ---------------------------------------------------------------------------

const withTx = results.filter((r) => r.txId);
let confirmed = 0;

if (withTx.length) {
  console.log(`\n  Confirming ${withTx.length} transaction(s) on-chain...`);
  for (const r of withTx) {
    try {
      const info = await algod.pendingTransactionInformation(r.txId).do();
      const round = info.confirmedRound ?? info["confirmed-round"];
      if (round) confirmed++;
    } catch {
      // Fall through: pending-tx info expires quickly on testnet nodes.
    }
  }
}

const payerAfter = await usdcBalance(PAYER);
const recvAfter = await usdcBalance(RECEIVER);
const paid = results.filter((r) => r.ok).length;
const lat = results.map((r) => r.ms).sort((a, b) => a - b);

console.log("\n" + "=".repeat(56));
console.log("  Paid path results");
console.log("=".repeat(56));
console.log(`  attempted             ${results.length}`);
console.log(`  settled (HTTP 200)    ${paid}`);
console.log(`  with a txId           ${withTx.length}`);
console.log(`  confirmed on-chain    ${confirmed}`);
console.log("");
console.log(`  median latency        ${(lat[Math.floor(lat.length / 2)] ?? 0).toFixed(0)} ms`);
console.log("");
console.log(`  payer USDC     ${payerBefore.toFixed(6)} → ${payerAfter.toFixed(6)}  (${(payerAfter - payerBefore).toFixed(6)})`);
console.log(`  receiver USDC  ${recvBefore.toFixed(6)} → ${recvAfter.toFixed(6)}  (+${(recvAfter - recvBefore).toFixed(6)})`);
console.log("=".repeat(56));

const moved = Math.abs(recvAfter - recvBefore) > 1e-9;
const ok = paid === REQUESTS && moved;
console.log(ok ? `\nPASS — all ${REQUESTS} requests settled and USDC moved on-chain.\n`
               : `\nFAIL — ${paid}/${REQUESTS} settled; receiver delta ${(recvAfter - recvBefore).toFixed(6)} USDC.\n`);

if (results.some((r) => r.error)) {
  console.log("  first error: " + results.find((r) => r.error).error.slice(0, 300) + "\n");
}

server.close();
backend.close();
process.exit(ok ? 0 : 1);
