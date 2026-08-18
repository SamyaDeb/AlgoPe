/**
 * Facilitator selection tests.
 *
 * resolveFacilitator decides who settles real money, so the important cases
 * here are the failure ones: an unreachable facilitator must degrade rather
 * than take the gateway down, and an ALGO-priced service must never be handed
 * to a facilitator that cannot settle it.
 *
 * All network access is mocked. The live counterpart is facilitator-live.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  probeFacilitator,
  schemeForToken,
  caip2For,
} from "../src/facilitator/goplausible.js";
import { resolveFacilitator } from "../src/facilitator/resolve.js";
import {
  ALGORAND_TESTNET_CAIP2,
  ALGORAND_MAINNET_CAIP2,
  type AlgoPeConfig,
} from "../src/types.js";

const FEE_PAYER = "ZMFK2OI7ZBD2U27ISERZC4S6LKM6WMFJPZQ4MYNJDZ2VNBNMBA67RA22AA";
const WALLET = "HMPG7YLTESN4FQXIGCAHQOXDEIDUIFBOINJDGQ7WUFBTYMOIKDIN6CITPM";

function config(over: Partial<AlgoPeConfig> = {}): AlgoPeConfig {
  return {
    serviceName: "Test",
    serviceDescription: "Test service",
    tags: [],
    targetUrl: "http://localhost:3000",
    pricePerRequest: "0.01",
    paymentToken: "USDC",
    walletAddress: WALLET,
    proxyPort: 4402,
    network: "testnet",
    ...over,
  } as AlgoPeConfig;
}

/** Mocks global fetch with per-path responses. */
function mockFetch(handlers: Record<string, unknown>, status = 200) {
  return vi.fn(async (url: string) => {
    const match = Object.keys(handlers).find((k) => String(url).includes(k));
    if (!match) return { ok: false, status: 404, json: async () => ({}) } as any;
    const body = handlers[match];
    if (body instanceof Error) throw body;
    return { ok: status < 400, status, json: async () => body } as any;
  });
}

const supported = (kinds: unknown[]) => ({ kinds });
const algoKind = (network: string, scheme = "exact", feePayer?: string) => ({
  x402Version: 2,
  scheme,
  network,
  ...(feePayer ? { extra: { feePayer } } : {}),
});

describe("caip2For", () => {
  it("maps the known networks", () => {
    expect(caip2For("testnet")).toBe(ALGORAND_TESTNET_CAIP2);
    expect(caip2For("mainnet")).toBe(ALGORAND_MAINNET_CAIP2);
  });

  it("throws on an unknown network instead of defaulting to mainnet", () => {
    // Defaulting here would silently settle real money on the wrong chain.
    expect(() => caip2For("devnet" as any)).toThrow();
  });
});

describe("schemeForToken", () => {
  it("routes USDC to the standard exact scheme", () => {
    expect(schemeForToken("USDC")).toBe("exact");
  });

  it("routes native ALGO to AlgoPe's algo-exact scheme", () => {
    expect(schemeForToken("ALGO")).toBe("algo-exact");
  });
});

describe("probeFacilitator", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
    vi.restoreAllMocks();
  });

  it("accepts a facilitator advertising our scheme and network", async () => {
    globalThis.fetch = mockFetch({
      "/supported": supported([algoKind(ALGORAND_TESTNET_CAIP2, "exact", FEE_PAYER)]),
      "/health": { networks: { [ALGORAND_TESTNET_CAIP2]: { status: "up" } } },
    }) as any;

    const r = await probeFacilitator({ network: "testnet", requiredScheme: "exact" });

    expect(r.usable).toBe(true);
    expect(r.schemes).toContain("exact");
    expect(r.feePayer).toBe(FEE_PAYER);
  });

  it("rejects when the required scheme is absent", async () => {
    globalThis.fetch = mockFetch({
      "/supported": supported([algoKind(ALGORAND_TESTNET_CAIP2, "exact")]),
      "/health": { networks: {} },
    }) as any;

    const r = await probeFacilitator({ network: "testnet", requiredScheme: "algo-exact" });

    expect(r.usable).toBe(false);
    expect(r.reason).toMatch(/algo-exact/);
  });

  it("ignores kinds for other networks", async () => {
    globalThis.fetch = mockFetch({
      "/supported": supported([
        algoKind(ALGORAND_MAINNET_CAIP2, "exact", FEE_PAYER),
        { x402Version: 2, scheme: "exact", network: "eip155:8453" },
      ]),
      "/health": { networks: {} },
    }) as any;

    const r = await probeFacilitator({ network: "testnet", requiredScheme: "exact" });

    expect(r.usable).toBe(false);
    expect(r.feePayer).toBeUndefined();
  });

  it("reports unreachable rather than throwing", async () => {
    globalThis.fetch = mockFetch({ "/supported": new Error("ECONNREFUSED") }) as any;

    const r = await probeFacilitator({ network: "testnet", requiredScheme: "exact" });

    expect(r.usable).toBe(false);
    expect(r.reason).toMatch(/unreachable/i);
  });

  it("stays usable when /health is unavailable, since health is advisory", async () => {
    globalThis.fetch = mockFetch({
      "/supported": supported([algoKind(ALGORAND_TESTNET_CAIP2, "exact", FEE_PAYER)]),
      "/health": new Error("timeout"),
    }) as any;

    const r = await probeFacilitator({ network: "testnet", requiredScheme: "exact" });
    expect(r.usable).toBe(true);
  });

  it("has no feePayer when the facilitator does not sponsor fees", async () => {
    globalThis.fetch = mockFetch({
      "/supported": supported([algoKind(ALGORAND_TESTNET_CAIP2, "exact")]),
      "/health": { networks: {} },
    }) as any;

    const r = await probeFacilitator({ network: "testnet", requiredScheme: "exact" });

    expect(r.usable).toBe(true);
    expect(r.feePayer).toBeUndefined();
  });
});

describe("resolveFacilitator", () => {
  const original = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = mockFetch({
      "/supported": supported([algoKind(ALGORAND_TESTNET_CAIP2, "exact", FEE_PAYER)]),
      "/health": { networks: { [ALGORAND_TESTNET_CAIP2]: { status: "up" } } },
    }) as any;
  });
  afterEach(() => {
    globalThis.fetch = original;
    vi.restoreAllMocks();
  });

  it("selects the remote facilitator for USDC under auto", async () => {
    const r = await resolveFacilitator({ config: config({ facilitatorMode: "auto" }) });

    expect(r.mode).toBe("goplausible");
    expect(r.feePayer).toBe(FEE_PAYER);
    expect(r.description).toMatch(/gasless/);
    expect(r.fallbackReason).toBeUndefined();
  });

  it("falls back to self-settlement under auto when the remote is unusable", async () => {
    globalThis.fetch = mockFetch({ "/supported": new Error("down") }) as any;

    const r = await resolveFacilitator({ config: config({ facilitatorMode: "auto" }) });

    // Degrading matters more than failing: the gateway must keep serving.
    expect(r.mode).toBe("self");
    expect(r.fallbackReason).toBeTruthy();
  });

  it("fails fast when goplausible is demanded but unusable", async () => {
    globalThis.fetch = mockFetch({ "/supported": new Error("down") }) as any;

    await expect(
      resolveFacilitator({ config: config({ facilitatorMode: "goplausible" }) })
    ).rejects.toThrow(/cannot settle/i);
  });

  it("explains the ALGO limitation when goplausible is demanded for ALGO pricing", async () => {
    const r = resolveFacilitator({
      config: config({ facilitatorMode: "goplausible", paymentToken: "ALGO" }),
    });

    await expect(r).rejects.toThrow(/algo-exact/);
    await expect(r).rejects.toThrow(/USDC/);
  });

  it("degrades ALGO pricing to the native settler under auto", async () => {
    const r = await resolveFacilitator({
      config: config({ facilitatorMode: "auto", paymentToken: "ALGO" }),
    });

    expect(r.mode).toBe("self");
    expect(r.description).toMatch(/ALGO native/i);
  });

  it("uses the simple verifier for self mode with USDC", async () => {
    const r = await resolveFacilitator({ config: config({ facilitatorMode: "self" }) });

    expect(r.mode).toBe("self");
    expect(r.description).toMatch(/simple verifier/i);
  });

  it("does not contact the network in self mode", async () => {
    const spy = globalThis.fetch as any;
    await resolveFacilitator({ config: config({ facilitatorMode: "self" }) });
    expect(spy).not.toHaveBeenCalled();
  });

  it("throws when local mode is requested without a mnemonic", async () => {
    await expect(
      resolveFacilitator({ config: config({ facilitatorMode: "local" }) })
    ).rejects.toThrow(/mnemonic/i);
  });

  it("rejects an invalid network before any settlement decision", async () => {
    await expect(
      resolveFacilitator({ config: config({ network: "devnet" as any }) })
    ).rejects.toThrow();
  });
});
