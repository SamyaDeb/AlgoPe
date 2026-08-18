/**
 * Facilitator resolution
 *
 * Picks which facilitator settles payments for `algope start`, and says why.
 * Kept out of proxy/server.ts so the choice is testable and logged in one place.
 *
 * Order of preference:
 *  1. `goplausible` — the hosted remote facilitator. Gasless for consumers, no
 *     provider key needed, feeds Bazaar discovery. Requires the facilitator to
 *     actually advertise our scheme+network, which is checked live.
 *  2. `local` — in-process x402Facilitator signing with a provider mnemonic.
 *  3. `algo-native` / `simple` — settle by relaying the client-signed group
 *     ourselves. Always available; the consumer pays their own network fee.
 */

import type { AlgoPeConfig, PaymentToken } from "../types.js";
import type { FacilitatorClient } from "./algo-facilitator.js";
import { createAlgoNativeFacilitator } from "./algo-facilitator.js";
import { createLocalFacilitator } from "./local-facilitator-client.js";
import { createSimpleVerifier } from "./simple-verifier.js";
import {
  createGoPlausibleFacilitator,
  probeFacilitator,
  schemeForToken,
  caip2For,
} from "./goplausible.js";

export type FacilitatorMode = "goplausible" | "local" | "self" | "auto";

export interface ResolvedFacilitator {
  client: FacilitatorClient;
  /** Which implementation was actually selected. */
  mode: Exclude<FacilitatorMode, "auto">;
  /** One-line operator-facing explanation of the choice. */
  description: string;
  /** Set when we wanted the remote facilitator but could not use it. */
  fallbackReason?: string;
  /** Fee-payer address, when the selected facilitator sponsors network fees. */
  feePayer?: string;
}

export interface ResolveFacilitatorOptions {
  config: AlgoPeConfig;
  /** Mnemonic for `local` mode (from `algope start --facilitator`). */
  facilitatorMnemonic?: string;
}

/**
 * Resolves the facilitator for a proxy run. Performs a network preflight when
 * remote mode is in play, and never throws — it degrades to local settlement.
 */
export async function resolveFacilitator(
  options: ResolveFacilitatorOptions
): Promise<ResolvedFacilitator> {
  const { config, facilitatorMnemonic } = options;
  const requested: FacilitatorMode = config.facilitatorMode ?? "auto";
  const token: PaymentToken = config.paymentToken;

  // Validate up front so a bad network fails loudly here rather than silently
  // settling against the wrong chain further down.
  caip2For(config.network);

  // Explicit local mode always wins — the operator supplied a signing key on purpose.
  if (requested === "local" || (requested === "auto" && facilitatorMnemonic)) {
    if (!facilitatorMnemonic) {
      throw new Error(
        'facilitatorMode is "local" but no mnemonic was provided. Pass one with: algope start --facilitator "<25 words>"'
      );
    }
    return {
      client: createLocalFacilitator(facilitatorMnemonic, config.network),
      mode: "local",
      description: "Local facilitator (in-process, signs with your mnemonic)",
    };
  }

  if (requested === "self") {
    return selfSettle(config);
  }

  // "auto" and "goplausible": try the remote facilitator, verifying it can settle
  // this token's scheme on this network before we commit to it.
  const requiredScheme = schemeForToken(token);
  const probe = await probeFacilitator({
    network: config.network,
    url: config.facilitatorUrl,
    apiKey: config.facilitatorApiKey,
    requiredScheme,
  });

  if (probe.usable) {
    return {
      client: createGoPlausibleFacilitator({
        network: config.network,
        url: config.facilitatorUrl,
        apiKey: config.facilitatorApiKey,
      }),
      mode: "goplausible",
      description: `GoPlausible facilitator at ${probe.url}${
        probe.feePayer ? " (gasless — facilitator sponsors network fees)" : ""
      }`,
      feePayer: probe.feePayer,
    };
  }

  // Remote unusable. If the operator explicitly asked for it, that's an error;
  // under "auto" we quietly degrade so the gateway still serves paid traffic.
  if (requested === "goplausible") {
    throw new Error(
      `Remote facilitator ${probe.url} cannot settle this service: ${probe.reason}. ` +
        (requiredScheme === "algo-exact"
          ? 'Native-ALGO pricing uses AlgoPe\'s "algo-exact" scheme, which the hosted facilitator does not implement — price in USDC to use it, or set facilitatorMode to "self".'
          : 'Set facilitatorMode to "self" or "local" to settle without it.')
    );
  }

  const fallback = selfSettle(config);
  return { ...fallback, fallbackReason: probe.reason };
}

/**
 * Settle by relaying the client-signed transaction group ourselves.
 * No key required; the paying client covers its own Algorand fee.
 */
function selfSettle(config: AlgoPeConfig): ResolvedFacilitator {
  if (config.paymentToken === "ALGO") {
    return {
      client: createAlgoNativeFacilitator(config.walletAddress, config.network),
      mode: "self",
      description: "ALGO native settler (relays client-signed payment txns)",
    };
  }
  return {
    client: createSimpleVerifier(config.walletAddress, config.network),
    mode: "self",
    description: "Simple verifier (relays client-signed ASA transfers, no key needed)",
  };
}
