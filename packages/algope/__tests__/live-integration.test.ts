/**
 * Live integration tests — opt-in with LIVE=1.
 *
 * These hit the real Algorand testnet and the real GoPlausible facilitator, so
 * they are skipped by default: CI must stay hermetic and must not depend on
 * third-party uptime. Run them to verify a deployment:
 *
 *   npm run test:live --workspace=@algope/cli
 *
 * They are read-only. Nothing here signs or submits a transaction.
 */

import { describe, it, expect } from "vitest";
import algosdk from "algosdk";

import { AlgoPeRegistryClient } from "../src/registry.js";
import { probeFacilitator, caip2For } from "../src/facilitator/goplausible.js";
import { ALGORAND_TESTNET_CAIP2 } from "../src/types.js";

const LIVE = process.env.LIVE === "1";
const d = LIVE ? describe : describe.skip;

const APP_ID = BigInt(process.env.ALGOPE_REGISTRY_APP_ID ?? "769455464");
const ALGOD = "https://testnet-api.algonode.cloud";

d("live: registry contract", () => {
  const algod = new algosdk.Algodv2("", ALGOD, "");

  it("is deployed and reachable", async () => {
    const app = await algod.getApplicationByID(Number(APP_ID)).do();
    expect(Number(app.id)).toBe(Number(APP_ID));
  });

  it("declares no global or local state", async () => {
    const app: any = await algod.getApplicationByID(Number(APP_ID)).do();
    expect(Number(app.params.globalStateSchema?.numUint ?? 0)).toBe(0);
    expect(Number(app.params.globalStateSchema?.numByteSlice ?? 0)).toBe(0);
    expect(Number(app.params.localStateSchema?.numUint ?? 0)).toBe(0);
    expect(Number(app.params.localStateSchema?.numByteSlice ?? 0)).toBe(0);
  });

  it("matches the locally compiled approval program", async () => {
    // Catches "the deployed app is not the code in this repo" drift.
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const spec = JSON.parse(
      readFileSync(
        path.resolve(dir, "../../../contracts/src/out/AlgoPeRegistry.arc56.json"),
        "utf-8"
      )
    );

    const local = Buffer.from(spec.byteCode.approval, "base64");
    const app: any = await algod.getApplicationByID(Number(APP_ID)).do();
    const onChain = Buffer.from(app.params.approvalProgram);

    expect(onChain.length).toBe(local.length);
    expect(onChain.equals(local)).toBe(true);
  });

  it("resolves the configured app id", async () => {
    const client = new AlgoPeRegistryClient("testnet");
    const info = await client.getContractInfo();
    expect(String(info.appId)).toBe(String(APP_ID));
  });

  it("reports a missing service as absent instead of throwing", async () => {
    const client = new AlgoPeRegistryClient("testnet");
    const random = algosdk.generateAccount().addr.toString();
    await expect(client.hasService(random, "definitely-not-registered")).resolves.toBe(false);
  });
});

d("live: GoPlausible facilitator", () => {
  const URL = "https://facilitator.goplausible.xyz";

  it("is healthy on Algorand testnet", async () => {
    const res = await fetch(`${URL}/health`);
    expect(res.ok).toBe(true);
    const body: any = await res.json();
    expect(body.status).toBe("healthy");
    expect(body.networks[ALGORAND_TESTNET_CAIP2].status).toBe("up");
  });

  it("advertises the exact scheme for Algorand testnet with a fee payer", async () => {
    const probe = await probeFacilitator({ network: "testnet", requiredScheme: "exact" });

    expect(probe.usable).toBe(true);
    expect(probe.schemes).toContain("exact");
    // Without a feePayer, callers must hold ALGO for fees — gasless breaks.
    expect(probe.feePayer).toBeTruthy();
    expect(algosdk.isValidAddress(probe.feePayer!)).toBe(true);
  });

  it("does not offer AlgoPe's algo-exact scheme", async () => {
    // Documented limitation. If this ever starts passing, native-ALGO services
    // can use the hosted facilitator and the README guidance should change.
    const probe = await probeFacilitator({ network: "testnet", requiredScheme: "algo-exact" });
    expect(probe.usable).toBe(false);
  });

  it("uses the CAIP-2 id we send", async () => {
    const res = await fetch(`${URL}/supported`);
    const body: any = await res.json();
    const ours = body.kinds.filter((k: any) => k.network === caip2For("testnet"));
    expect(ours.length).toBeGreaterThan(0);
  });
});
