/**
 * Route/pricing tests.
 *
 * createRoutesConfig produces the `accepts` block that becomes the 402
 * challenge, so a mistake here is charged to real callers. The decimal→
 * microunit conversion and the USDC `asset` field are the two things most
 * likely to silently break settlement.
 */

import { describe, it, expect } from "vitest";

import { createRoutesConfig, formatRoutesForDisplay } from "../src/proxy/routeConfig.js";
import {
  ALGORAND_TESTNET_CAIP2,
  ALGORAND_MAINNET_CAIP2,
  USDC_TESTNET_ASA_ID,
  USDC_MAINNET_ASA_ID,
  type AlgoPeConfig,
} from "../src/types.js";

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

/** The catch-all route the proxy always installs. */
function catchAll(cfg: AlgoPeConfig) {
  const routes = createRoutesConfig(cfg) as Record<string, any>;
  const key = Object.keys(routes).find((k) => k.includes("*")) ?? Object.keys(routes)[0];
  return routes[key].accepts;
}

describe("scheme selection", () => {
  it("uses exact for USDC", () => {
    expect(catchAll(config({ paymentToken: "USDC" })).scheme).toBe("exact");
  });

  it("uses algo-exact for native ALGO", () => {
    expect(catchAll(config({ paymentToken: "ALGO" })).scheme).toBe("algo-exact");
  });
});

describe("network selection", () => {
  it("emits the testnet CAIP-2 id", () => {
    expect(catchAll(config({ network: "testnet" })).network).toBe(ALGORAND_TESTNET_CAIP2);
  });

  it("emits the mainnet CAIP-2 id", () => {
    expect(catchAll(config({ network: "mainnet" })).network).toBe(ALGORAND_MAINNET_CAIP2);
  });
});

describe("amount conversion", () => {
  const cases: Array<[string, string]> = [
    ["0.01", "10000"],
    ["1", "1000000"],
    ["0.000001", "1"],
    ["0", "0"],
    ["10.5", "10500000"],
    ["0.1", "100000"],
    ["123.456789", "123456789"],
  ];

  it.each(cases)("converts %s USDC to %s microunits", (input, expected) => {
    const accepts = catchAll(config({ paymentToken: "USDC", pricePerRequest: input }));
    expect(accepts.price.amount).toBe(expected);
  });

  it("converts ALGO to a bare microALGO string, not an AssetAmount", () => {
    const accepts = catchAll(config({ paymentToken: "ALGO", pricePerRequest: "0.01" }));
    expect(accepts.price).toBe("10000");
  });

  it("truncates sub-microunit precision rather than rounding up", () => {
    // 7 decimals: the 7th digit is beyond ASA precision and must not inflate
    // the charge.
    const accepts = catchAll(config({ pricePerRequest: "0.0000019" }));
    expect(accepts.price.amount).toBe("1");
  });
});

describe("USDC asset identification", () => {
  it("uses the numeric testnet ASA id, never the 'USDC' label", () => {
    const accepts = catchAll(config({ network: "testnet" }));
    // A label here makes the facilitator fail every payment with ASSET_MISMATCH.
    expect(accepts.price.asset).toBe(String(USDC_TESTNET_ASA_ID));
    expect(accepts.price.asset).not.toBe("USDC");
    expect(Number(accepts.price.asset)).toBeGreaterThan(0);
  });

  it("uses the mainnet ASA id on mainnet", () => {
    const accepts = catchAll(config({ network: "mainnet" }));
    expect(accepts.price.asset).toBe(String(USDC_MAINNET_ASA_ID));
  });

  it("advertises 6 decimals for USDC", () => {
    const accepts = catchAll(config());
    expect(accepts.extra.assetDecimals).toBe(6);
    expect(accepts.extra.assetId).toBe(USDC_TESTNET_ASA_ID);
  });

  it("attaches no ASA metadata for native ALGO", () => {
    const accepts = catchAll(config({ paymentToken: "ALGO" }));
    expect(accepts.extra).toBeUndefined();
  });
});

describe("payee and timeout", () => {
  it("pays the configured wallet directly", () => {
    expect(catchAll(config()).payTo).toBe(WALLET);
  });

  it("sets a settlement timeout", () => {
    expect(catchAll(config()).maxTimeoutSeconds).toBe(300);
  });
});

describe("additional routes", () => {
  it("prices a per-route override independently of the default", () => {
    const routes = createRoutesConfig(config({ pricePerRequest: "0.01" }), [
      { path: "/premium", pricePerRequest: "0.50", paymentToken: "USDC", description: "Premium" },
    ] as any) as Record<string, any>;

    const premium = Object.entries(routes).find(([k]) => k.includes("/premium"));
    expect(premium).toBeDefined();
    expect(premium![1].accepts.price.amount).toBe("500000");
  });
});

describe("formatRoutesForDisplay", () => {
  it("renders human-readable prices for the CLI banner", () => {
    const rows = formatRoutesForDisplay(createRoutesConfig(config()));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].token).toBe("USDC");
    // Should show the decimal price back, not raw microunits.
    expect(rows[0].price).not.toMatch(/^\d{5,}$/);
  });
});
