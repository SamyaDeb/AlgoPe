#!/usr/bin/env node
/**
 * AlgoPe proxy load test.
 *
 * Spins up a backend and a real AlgoPe x402 proxy in-process, then drives
 * traffic through them and reports latency percentiles and throughput.
 *
 * Two modes:
 *
 *   challenge (default) — unpaid requests that exercise the full proxy path
 *     and 402 challenge generation. No money moves and no third-party
 *     facilitator is called per request, so this scales to any N and is the
 *     mode to use for real load numbers.
 *
 *   paid — end-to-end settled payments. Each request costs real testnet USDC
 *     and puts a transaction on-chain, so keep N small and be aware that in
 *     goplausible mode every request also hits a third-party service.
 *
 * Usage:
 *   node scripts/loadtest.mjs --requests 1000 --concurrency 50
 *   node scripts/loadtest.mjs --mode paid --requests 10 --mnemonic "..."
 */

import http from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { startProxyServer } from "../dist/index.js";

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const REQUESTS = Number(arg("requests", 1000));
const CONCURRENCY = Number(arg("concurrency", 50));
const MODE = arg("mode", "challenge");
const FACILITATOR = arg("facilitator-mode", "goplausible");
const BACKEND_PORT = Number(arg("backend-port", 3999));
const PROXY_PORT = Number(arg("proxy-port", 4999));
const WALLET = arg("wallet", "HMPG7YLTESN4FQXIGCAHQOXDEIDUIFBOINJDGQ7WUFBTYMOIKDIN6CITPM");

// ---------------------------------------------------------------------------
// Backend — several distinct endpoints so routing is exercised, not one path
// ---------------------------------------------------------------------------

const ENDPOINTS = [
  { path: "/weather", body: () => ({ city: "Delhi", tempC: 31 + (Math.random() * 4 - 2) }) },
  { path: "/forecast", body: () => ({ city: "Delhi", days: 5 }) },
  { path: "/btc/price", body: () => ({ symbol: "BTC", usd: 64000 + Math.random() * 500 }) },
  { path: "/crypto", body: () => ({ symbol: "ALGO", usd: 0.18 }) },
  { path: "/news/top", body: () => ({ items: ["a", "b", "c"] }) },
];

function startBackend(port) {
  const server = http.createServer((req, res) => {
    const path = req.url.split("?")[0];
    const ep = ENDPOINTS.find((e) => e.path === path);
    res.setHeader("content-type", "application/json");
    if (!ep) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ error: "not found" }));
    }
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, ...ep.body() }));
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[i];
}

function report(latencies, statuses, wallMs, errors) {
  const sorted = [...latencies].sort((a, b) => a - b);
  const counts = statuses.reduce((m, s) => ((m[s] = (m[s] || 0) + 1), m), {});

  const fmt = (n) => `${n.toFixed(1)} ms`;

  console.log("\n" + "=".repeat(56));
  console.log("  Load test results");
  console.log("=".repeat(56));
  console.log(`  requests        ${latencies.length}`);
  console.log(`  concurrency     ${CONCURRENCY}`);
  console.log(`  wall time       ${(wallMs / 1000).toFixed(2)} s`);
  console.log(`  throughput      ${(latencies.length / (wallMs / 1000)).toFixed(1)} req/s`);
  console.log("");
  console.log(`  min             ${fmt(sorted[0] ?? 0)}`);
  console.log(`  p50             ${fmt(percentile(sorted, 50))}`);
  console.log(`  p90             ${fmt(percentile(sorted, 90))}`);
  console.log(`  p99             ${fmt(percentile(sorted, 99))}`);
  console.log(`  max             ${fmt(sorted[sorted.length - 1] ?? 0)}`);
  console.log(`  mean            ${fmt(sorted.reduce((a, b) => a + b, 0) / (sorted.length || 1))}`);
  console.log("");
  console.log("  status codes");
  for (const [code, n] of Object.entries(counts).sort()) {
    console.log(`    ${code}           ${n}`);
  }
  if (errors.length) {
    console.log(`\n  transport errors  ${errors.length}`);
    const uniq = [...new Set(errors)].slice(0, 5);
    for (const e of uniq) console.log(`    - ${e}`);
  }
  console.log("=".repeat(56) + "\n");

  return { counts, errors: errors.length };
}

// ---------------------------------------------------------------------------
// Driver — fixed-size worker pool
// ---------------------------------------------------------------------------

async function drive(total, concurrency, doRequest) {
  const latencies = [];
  const statuses = [];
  const errors = [];
  let issued = 0;

  const started = performance.now();

  const worker = async () => {
    while (true) {
      const n = issued++;
      if (n >= total) return;
      const ep = ENDPOINTS[n % ENDPOINTS.length];
      const t0 = performance.now();
      try {
        const status = await doRequest(ep.path);
        latencies.push(performance.now() - t0);
        statuses.push(status);
      } catch (e) {
        latencies.push(performance.now() - t0);
        statuses.push("ERR");
        errors.push(String(e.message ?? e).slice(0, 80));
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
  return { latencies, statuses, errors, wallMs: performance.now() - started };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const config = {
  serviceName: "Load Test Service",
  serviceDescription: "Synthetic load test",
  tags: ["loadtest"],
  targetUrl: `http://127.0.0.1:${BACKEND_PORT}`,
  pricePerRequest: "0.001",
  paymentToken: "USDC",
  walletAddress: WALLET,
  proxyPort: PROXY_PORT,
  network: "testnet",
  logLevel: "quiet",
  facilitatorMode: FACILITATOR,
};

console.log(`\nAlgoPe load test`);
console.log(`  mode          ${MODE}`);
console.log(`  requests      ${REQUESTS}`);
console.log(`  concurrency   ${CONCURRENCY}`);
console.log(`  endpoints     ${ENDPOINTS.length} distinct paths`);
console.log(`  facilitator   ${FACILITATOR}`);

const backend = await startBackend(BACKEND_PORT);
console.log(`  backend       http://127.0.0.1:${BACKEND_PORT}`);

const { server, facilitator } = await startProxyServer({ config });
console.log(`  proxy         http://127.0.0.1:${PROXY_PORT}`);
console.log(`  resolved      ${facilitator.description}`);
if (facilitator.fallbackReason) {
  console.log(`  fallback      ${facilitator.fallbackReason}`);
}

// Warm up so JIT and the facilitator probe do not skew the first samples.
for (const ep of ENDPOINTS) {
  await fetch(`http://127.0.0.1:${PROXY_PORT}${ep.path}`).catch(() => {});
}
await sleep(100);

let result;

if (MODE === "challenge") {
  console.log(`\nDriving ${REQUESTS} unpaid requests (402 challenge path)...`);
  result = await drive(REQUESTS, CONCURRENCY, async (path) => {
    const res = await fetch(`http://127.0.0.1:${PROXY_PORT}${path}`, {
      headers: { accept: "application/json" },
    });
    // Drain the body so sockets are released.
    await res.arrayBuffer();
    return res.status;
  });
} else {
  console.error(
    `\nmode "${MODE}" is not implemented in this harness.\n` +
      `Paid load generation settles real testnet USDC on-chain and, in\n` +
      `goplausible mode, drives a third-party production facilitator. Use the\n` +
      `challenge mode for throughput numbers and run a small number of real\n` +
      `payments separately to verify settlement.\n`
  );
  server.close();
  backend.close();
  process.exit(2);
}

const summary = report(result.latencies, result.statuses, result.wallMs, result.errors);

// A 402 on every unpaid request is the correct outcome for this mode.
const expected402 = summary.counts["402"] ?? 0;
const ok = expected402 === REQUESTS && summary.errors === 0;

console.log(
  ok
    ? `PASS — all ${REQUESTS} unpaid requests were correctly challenged with 402.\n`
    : `FAIL — expected ${REQUESTS} × 402, got ${expected402}; ${summary.errors} transport errors.\n`
);

server.close();
backend.close();
process.exit(ok ? 0 : 1);
