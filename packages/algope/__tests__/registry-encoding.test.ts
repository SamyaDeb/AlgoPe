/**
 * Registry encoding tests.
 *
 * These cover the hand-rolled ARC-4 encode/decode path in registry.ts. That
 * code exists because the client talks to a PuyaTs contract without using an
 * app client, so any drift between the contract's ABI and these helpers is a
 * silent production break. The selector test below reads the compiled ARC-56
 * artifact directly, so recompiling the contract with a changed signature
 * fails CI instead of failing on-chain.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import algosdk from "algosdk";

import {
  methodSelector,
  encodeArc4String,
  buildAppArgs,
  buildGetServiceArgs,
  decodeServiceData,
  buildBoxKey,
} from "../src/registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARC56_PATH = path.resolve(
  __dirname,
  "../../../contracts/src/out/AlgoPeRegistry.arc56.json"
);

const DEV = "EZDWPOTBKBWCBQ4M6QXWF4Z3PJB5Q6XN6XAGL5KPR3ESC3HF33JAAN57A4";

// The signatures registry.ts builds selectors from.
const CLIENT_SIGNATURES = [
  "register(pay,string,string,string,string,string,string,string,string)void",
  "update(pay,string,string,string,string,string,string,string,string)void",
  "deregister(string)void",
  "getService(address,string)(string,string,string,string,string,string,string,string,address,uint64,uint64)",
  "hasService(address,string)bool",
  "getAdmin()string",
  "getRegistrationFee()uint64",
];

describe("ARC-4 string encoding", () => {
  it("prefixes a uint16 big-endian length", () => {
    const out = encodeArc4String("abc");
    expect(Array.from(out)).toEqual([0x00, 0x03, 0x61, 0x62, 0x63]);
  });

  it("encodes the empty string as a bare zero length", () => {
    expect(Array.from(encodeArc4String(""))).toEqual([0x00, 0x00]);
  });

  it("counts UTF-8 bytes, not code points", () => {
    // "€" is 3 bytes; a naive .length would write 1 and corrupt the tail.
    const out = encodeArc4String("€");
    expect(out[0]).toBe(0x00);
    expect(out[1]).toBe(0x03);
    expect(out.length).toBe(5);
  });

  it("handles a 4-byte astral character", () => {
    const out = encodeArc4String("🚀");
    expect(out[1]).toBe(0x04);
    expect(out.length).toBe(6);
  });
});

describe("box key construction", () => {
  it("matches the contract layout: 'svc:' + pubkey(32) + ':' + name", () => {
    const key = buildBoxKey(DEV, "Weather API");
    const pubkey = algosdk.decodeAddress(DEV).publicKey;

    expect(new TextDecoder().decode(key.slice(0, 4))).toBe("svc:");
    expect(Array.from(key.slice(4, 36))).toEqual(Array.from(pubkey));
    expect(key[36]).toBe(0x3a); // ':'
    expect(new TextDecoder().decode(key.slice(37))).toBe("Weather API");
    expect(key.length).toBe(4 + 32 + 1 + "Weather API".length);
  });

  it("gives different developers different keys for the same name", () => {
    const other = algosdk.generateAccount().addr.toString();
    const a = buildBoxKey(DEV, "Weather API");
    const b = buildBoxKey(other, "Weather API");
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it("round-trips the developer address out of the key", () => {
    const key = buildBoxKey(DEV, "svc:with:colons");
    expect(algosdk.encodeAddress(key.slice(4, 36))).toBe(DEV);
    // Names containing ':' still decode, because the pubkey is fixed-width.
    expect(new TextDecoder().decode(key.slice(37))).toBe("svc:with:colons");
  });
});

describe("app args", () => {
  it("puts the selector first and one ARC-4 string per parameter", () => {
    const sel = methodSelector(CLIENT_SIGNATURES[0]);
    const args = buildAppArgs(sel, "a", "b", "c");

    expect(args).toHaveLength(4);
    expect(Array.from(args[0])).toEqual(Array.from(sel));
    expect(Array.from(args[1])).toEqual([0x00, 0x01, 0x61]);
  });

  it("encodes getService args as selector + raw 32-byte address + ARC-4 string", () => {
    const sel = methodSelector(CLIENT_SIGNATURES[3]);
    const args = buildGetServiceArgs(sel, DEV, "Weather API");

    expect(args).toHaveLength(3);
    // The address is a static ARC-4 type: 32 raw bytes, no length prefix.
    expect(args[1].length).toBe(32);
    expect(Array.from(args[1])).toEqual(Array.from(algosdk.decodeAddress(DEV).publicKey));
    expect(args[2][1]).toBe("Weather API".length);
  });
});

describe("contract/client ABI agreement", () => {
  const spec = JSON.parse(readFileSync(ARC56_PATH, "utf-8"));

  const specSignatures: string[] = spec.methods.map(
    (m: any) => `${m.name}(${m.args.map((a: any) => a.type).join(",")})${m.returns.type}`
  );

  it.each(CLIENT_SIGNATURES)("compiled contract exposes %s", (sig) => {
    expect(specSignatures).toContain(sig);
  });

  it("derives selectors that match the compiled artifact", () => {
    for (const sig of CLIENT_SIGNATURES) {
      const expected = algosdk.ABIMethod.fromSignature(sig).getSelector();
      expect(Array.from(methodSelector(sig))).toEqual(Array.from(expected));
    }
  });

  it("uses the same box prefix as the contract", () => {
    const prefix = Buffer.from(spec.state.maps.box.services.prefix, "base64").toString("utf-8");
    expect(prefix).toBe("svc:");
    expect(new TextDecoder().decode(buildBoxKey(DEV, "x").slice(0, 4))).toBe(prefix);
  });

  it("declares no global or local state, so boxes are the only storage", () => {
    expect(spec.state.schema.global).toEqual({ ints: 0, bytes: 0 });
    expect(spec.state.schema.local).toEqual({ ints: 0, bytes: 0 });
  });
});

describe("decodeServiceData", () => {
  /** Builds the ARC-4 tuple getService returns, so decode is tested against a real layout. */
  function encodeServiceTuple(v: {
    strings: string[];
    developer: string;
    createdAt: number;
    updatedAt: number;
  }): Uint8Array {
    const HEAD = 8 * 2 + 32 + 8 + 8; // offsets + address + 2 uint64
    const tails = v.strings.map(encodeArc4String);

    const head = new Uint8Array(HEAD);
    const view = new DataView(head.buffer);

    let cursor = HEAD;
    tails.forEach((t, i) => {
      view.setUint16(i * 2, cursor, false);
      cursor += t.length;
    });

    head.set(algosdk.decodeAddress(v.developer).publicKey, 16);
    view.setBigUint64(48, BigInt(v.createdAt), false);
    view.setBigUint64(56, BigInt(v.updatedAt), false);

    const out = new Uint8Array(cursor);
    out.set(head, 0);
    let pos = HEAD;
    for (const t of tails) {
      out.set(t, pos);
      pos += t.length;
    }
    return out;
  }

  const base = {
    strings: [
      "Weather API",
      "Real-time weather",
      "weather, forecast, data",
      "https://example.com",
      "0.01",
      "USDC",
      DEV,
      "testnet",
    ],
    developer: DEV,
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_500,
  };

  it("round-trips every field", () => {
    const decoded = decodeServiceData(encodeServiceTuple(base));

    expect(decoded.name).toBe("Weather API");
    expect(decoded.description).toBe("Real-time weather");
    expect(decoded.endpoint).toBe("https://example.com");
    expect(decoded.pricePerRequest).toBe("0.01");
    expect(decoded.paymentToken).toBe("USDC");
    expect(decoded.walletAddress).toBe(DEV);
    expect(decoded.network).toBe("testnet");
    expect(decoded.developer).toBe(DEV);
    expect(decoded.createdAt).toBe(base.createdAt);
    expect(decoded.updatedAt).toBe(base.updatedAt);
  });

  it("splits and trims the comma-separated tag string", () => {
    const decoded = decodeServiceData(encodeServiceTuple(base));
    expect(decoded.tags).toEqual(["weather", "forecast", "data"]);
  });

  it("yields no tags for an empty tag string rather than ['']", () => {
    const decoded = decodeServiceData(
      encodeServiceTuple({ ...base, strings: [...base.strings.slice(0, 2), "", ...base.strings.slice(3)] })
    );
    expect(decoded.tags).toEqual([]);
  });

  it("survives multi-byte UTF-8 in string fields", () => {
    const decoded = decodeServiceData(
      encodeServiceTuple({
        ...base,
        strings: ["Wetter €", "Daten für Städte 🚀", ...base.strings.slice(2)],
      })
    );
    expect(decoded.name).toBe("Wetter €");
    expect(decoded.description).toBe("Daten für Städte 🚀");
  });

  it("decodes correctly when the byte array has a non-zero byteOffset", () => {
    // getService slices logs out of a larger buffer; a DataView built on the
    // raw .buffer without honouring byteOffset would read the wrong bytes.
    const encoded = encodeServiceTuple(base);
    const padded = new Uint8Array(encoded.length + 16);
    padded.set(encoded, 16);
    const view = padded.subarray(16);

    expect(view.byteOffset).toBe(16);
    expect(decodeServiceData(view).name).toBe("Weather API");
  });
});
