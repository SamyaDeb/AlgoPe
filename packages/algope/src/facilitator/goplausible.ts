/**
 * GoPlausible x402 Facilitator (remote)
 *
 * Wraps `HTTPFacilitatorClient` pointed at GoPlausible's hosted x402 facilitator
 * (https://facilitator.goplausible.xyz) — the reference facilitator for Algorand
 * x402, also covering Base and Solana behind the same endpoint.
 *
 * Why use it instead of settling locally:
 *  - **Gasless for consumers.** The facilitator advertises a `feePayer` address in
 *    its `/supported` response. `ExactAvmScheme.enhancePaymentRequirements()` copies
 *    that into the 402 challenge, so paying clients build an atomic group where the
 *    facilitator covers the Algorand fee. The consumer needs only USDC — no ALGO.
 *  - **No provider key.** Verification and settlement happen off-box, so `algope
 *    start` never needs a mnemonic to broadcast.
 *  - **Bazaar discovery.** Resources settled through the facilitator show up in its
 *    `/discovery/resources` catalog, which is what the Algorand MCP's Bazaar tools
 *    (and `search_bazaar`) read.
 *
 * Scheme coverage (checked live via `/supported`, not assumed):
 *  - `exact` on `algorand:*` — ASA payments, i.e. USDC. Supported.
 *  - `algo-exact` — AlgoPe's own native-ALGO scheme (`src/x402/algo/server-scheme.ts`).
 *    It is NOT part of upstream x402-avm, so the hosted facilitator cannot settle it.
 *    `probeFacilitator()` detects this and the caller falls back to a local settler.
 */

import { HTTPFacilitatorClient } from "@x402-avm/core/server";
import type {
  PaymentPayload,
  PaymentRequirements,
  VerifyResponse,
  SettleResponse,
  SupportedResponse,
} from "@x402-avm/core/types";

import {
  GOPLAUSIBLE_FACILITATOR_URL,
  ALGORAND_TESTNET_CAIP2,
  ALGORAND_MAINNET_CAIP2,
} from "../types.js";
import type { FacilitatorClient } from "./algo-facilitator.js";

/** Default seconds to wait on the facilitator preflight before falling back. */
const PROBE_TIMEOUT_MS = 8000;

export interface GoPlausibleFacilitatorOptions {
  /** Network the proxy is serving. Determines which CAIP-2 kind we require. */
  network: "testnet" | "mainnet";
  /** Override the facilitator base URL (self-hosted or staging). */
  url?: string;
  /** Optional bearer token, for facilitators that gate /verify and /settle. */
  apiKey?: string;
  /** Preflight timeout in ms. */
  timeoutMs?: number;
}

export interface FacilitatorProbeResult {
  /** True when the facilitator is reachable AND advertises the scheme we need. */
  usable: boolean;
  url: string;
  /** Why it is not usable — for the operator-facing log line. */
  reason?: string;
  /** Schemes the facilitator advertises for our CAIP-2 network. */
  schemes: string[];
  /** Fee-payer address for our network, when the facilitator sponsors fees. */
  feePayer?: string;
  /** Facilitator-reported health for our network, when exposed. */
  networkStatus?: string;
}

/**
 * CAIP-2 identifier for a AlgoPe network.
 *
 * Throws on anything else rather than defaulting. Config files are plain JSON and
 * are not validated by the type system, so a stale or typo'd value (e.g. "fuji"
 * left over from an EVM-era config) must not silently resolve to mainnet.
 */
export function caip2For(network: string): string {
  if (network === "testnet") return ALGORAND_TESTNET_CAIP2;
  if (network === "mainnet") return ALGORAND_MAINNET_CAIP2;
  throw new Error(
    `Unsupported network "${network}". AlgoPe settles on Algorand — expected "testnet" or "mainnet". ` +
      `Fix the "network" field in ~/.algope/config.json (or re-run "algope init").`
  );
}

/**
 * The x402 scheme a given AlgoPe payment token settles under.
 * USDC (and any ASA) uses upstream `exact`; native ALGO uses AlgoPe's `algo-exact`.
 */
export function schemeForToken(token: "ALGO" | "USDC"): string {
  return token === "ALGO" ? "algo-exact" : "exact";
}

function authHeaders(apiKey?: string) {
  if (!apiKey) return undefined;
  const headers = { Authorization: `Bearer ${apiKey}` };
  return async () => ({ verify: headers, settle: headers, supported: headers });
}

/**
 * Builds a facilitator client bound to GoPlausible's hosted x402 facilitator.
 *
 * This does no network I/O — call `probeFacilitator()` first if you want to know
 * whether the facilitator can actually settle your scheme before committing to it.
 */
export function createGoPlausibleFacilitator(
  options: GoPlausibleFacilitatorOptions
): FacilitatorClient {
  const url = options.url ?? GOPLAUSIBLE_FACILITATOR_URL;

  const client = new HTTPFacilitatorClient({
    url,
    createAuthHeaders: authHeaders(options.apiKey),
  });

  // HTTPFacilitatorClient already satisfies getSupported/verify/settle, but we
  // wrap it so failures surface as x402-shaped responses instead of throwing out
  // of the Express middleware and turning a declined payment into a 500.
  return {
    getSupported: (): Promise<SupportedResponse> => client.getSupported(),

    async verify(
      payload: PaymentPayload,
      requirements: PaymentRequirements
    ): Promise<VerifyResponse> {
      try {
        return await client.verify(payload, requirements);
      } catch (error) {
        return {
          isValid: false,
          invalidReason: `Facilitator verify failed (${url}): ${(error as Error).message}`,
        } as VerifyResponse;
      }
    },

    async settle(
      payload: PaymentPayload,
      requirements: PaymentRequirements
    ): Promise<SettleResponse> {
      try {
        return await client.settle(payload, requirements);
      } catch (error) {
        return {
          success: false,
          errorReason: "facilitator_unreachable",
          errorMessage: `Facilitator settle failed (${url}): ${(error as Error).message}`,
          transaction: "",
          network: caip2For(options.network),
        } as SettleResponse;
      }
    },
  };
}

/**
 * Preflight: is the facilitator up, and can it settle `requiredScheme` on our network?
 *
 * Never throws — an unreachable facilitator returns `usable: false` with a reason so
 * the proxy can fall back to local settlement instead of refusing to boot.
 */
export async function probeFacilitator(
  options: GoPlausibleFacilitatorOptions & { requiredScheme: string }
): Promise<FacilitatorProbeResult> {
  const url = (options.url ?? GOPLAUSIBLE_FACILITATOR_URL).replace(/\/+$/, "");
  const networkCaip2 = caip2For(options.network);
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const base: FacilitatorProbeResult = { usable: false, url, schemes: [] };

  const headers: Record<string, string> = options.apiKey
    ? { Authorization: `Bearer ${options.apiKey}` }
    : {};

  let supported: SupportedResponse;
  try {
    const response = await fetchJson(`${url}/supported`, headers, timeoutMs);
    supported = response as SupportedResponse;
  } catch (error) {
    return { ...base, reason: `unreachable: ${(error as Error).message}` };
  }

  const kinds = Array.isArray((supported as { kinds?: unknown }).kinds)
    ? ((supported as unknown as { kinds: Array<Record<string, unknown>> }).kinds)
    : [];

  const forNetwork = kinds.filter((kind) => kind.network === networkCaip2);
  const schemes = forNetwork.map((kind) => String(kind.scheme));

  if (forNetwork.length === 0) {
    return {
      ...base,
      schemes,
      reason: `does not serve ${options.network} (${networkCaip2})`,
    };
  }

  const match = forNetwork.find((kind) => kind.scheme === options.requiredScheme);
  const feePayer = forNetwork
    .map((kind) => (kind.extra as Record<string, unknown> | undefined)?.feePayer)
    .find((value): value is string => typeof value === "string");

  // /health is advisory — a facilitator that omits it is still usable.
  let networkStatus: string | undefined;
  try {
    const health = (await fetchJson(`${url}/health`, headers, timeoutMs)) as {
      networks?: Record<string, { status?: string }>;
    };
    networkStatus = health?.networks?.[networkCaip2]?.status;
  } catch {
    // ignore
  }

  if (!match) {
    return {
      ...base,
      schemes,
      feePayer,
      networkStatus,
      reason: `does not support the "${options.requiredScheme}" scheme (offers: ${
        schemes.join(", ") || "none"
      })`,
    };
  }

  if (networkStatus && networkStatus !== "up") {
    return {
      ...base,
      schemes,
      feePayer,
      networkStatus,
      reason: `reports ${options.network} as "${networkStatus}"`,
    };
  }

  return { usable: true, url, schemes, feePayer, networkStatus };
}

async function fetchJson(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}
