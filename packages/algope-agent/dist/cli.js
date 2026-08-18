#!/usr/bin/env node

// src/cli.ts
import { program } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";
import gradient from "gradient-string";
import ora from "ora";

// src/config.ts
import fs from "fs/promises";
import path from "path";
import os from "os";
import algosdk from "algosdk";

// src/keychain.ts
import keytar from "keytar";
var SERVICE_NAME = "algope-agent";
var WALLET_PREFIX = "wallet";
async function saveMnemonic(walletAddress, mnemonic) {
  const account = `${WALLET_PREFIX}-${walletAddress}`;
  await keytar.setPassword(SERVICE_NAME, account, mnemonic);
}
async function getMnemonic(walletAddress) {
  const account = `${WALLET_PREFIX}-${walletAddress}`;
  return await keytar.getPassword(SERVICE_NAME, account);
}
async function hasMnemonic(walletAddress) {
  const mnemonic = await getMnemonic(walletAddress);
  return mnemonic !== null;
}
async function listStoredWallets() {
  const credentials = await keytar.findCredentials(SERVICE_NAME);
  return credentials.filter((cred) => cred.account.startsWith(`${WALLET_PREFIX}-`)).map((cred) => cred.account.replace(`${WALLET_PREFIX}-`, ""));
}
async function isKeychainAvailable() {
  try {
    await keytar.findCredentials(SERVICE_NAME);
    return true;
  } catch {
    return false;
  }
}
async function migrateToKeychain(walletAddress, plaintextMnemonic) {
  try {
    const existing = await getMnemonic(walletAddress);
    if (existing) {
      return true;
    }
    await saveMnemonic(walletAddress, plaintextMnemonic);
    return true;
  } catch {
    return false;
  }
}
async function getCredentialInfo() {
  const available = await isKeychainAvailable();
  if (!available) {
    return { available: false, walletCount: 0, wallets: [] };
  }
  const wallets = await listStoredWallets();
  return {
    available: true,
    walletCount: wallets.length,
    wallets: wallets.map((w) => `${w.slice(0, 8)}...${w.slice(-4)}`)
    // Truncated for privacy
  };
}

// src/config.ts
var CONFIG_DIR = path.join(os.homedir(), ".algope");
var CONFIG_FILE = path.join(CONFIG_DIR, "agent.json");
var DEFAULT_REGISTRY_PATH = path.join(CONFIG_DIR, "registry.json");
async function ensureConfigDir() {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
}
async function loadConfig() {
  try {
    const data = await fs.readFile(CONFIG_FILE, "utf-8");
    const rawConfig = JSON.parse(data);
    if (rawConfig.wallet?.mnemonic) {
      if (!rawConfig.wallet.address) {
        rawConfig.wallet.address = addressFromMnemonic(rawConfig.wallet.mnemonic);
      }
      rawConfig.wallet._isLegacy = true;
    }
    const config = rawConfig;
    if (!config.llm.mode) {
      config.llm.mode = "api";
    }
    if (config.wallet.useKeychain === void 0) {
      config.wallet.useKeychain = !rawConfig.wallet._isLegacy;
    }
    return config;
  } catch {
    return null;
  }
}
async function isLegacyConfig() {
  try {
    const data = await fs.readFile(CONFIG_FILE, "utf-8");
    const rawConfig = JSON.parse(data);
    return !!rawConfig.wallet?.mnemonic;
  } catch {
    return false;
  }
}
async function getLegacyMnemonic() {
  try {
    const data = await fs.readFile(CONFIG_FILE, "utf-8");
    const rawConfig = JSON.parse(data);
    return rawConfig.wallet?.mnemonic || null;
  } catch {
    return null;
  }
}
async function saveConfig(config) {
  await ensureConfigDir();
  const cleanConfig = {
    llm: config.llm,
    wallet: {
      address: config.wallet.address,
      useKeychain: config.wallet.useKeychain !== false
      // Default to true
    },
    payment: config.payment,
    registryPath: config.registryPath,
    registryAppId: config.registryAppId,
    network: config.network
  };
  await fs.writeFile(CONFIG_FILE, JSON.stringify(cleanConfig, null, 2), {
    mode: 384
    // Read/write only for owner (contains API keys)
  });
}
function getConfigPath() {
  return CONFIG_FILE;
}
function getDefaultRegistryPath() {
  return DEFAULT_REGISTRY_PATH;
}
async function saveWalletToKeychain(walletAddress, mnemonic) {
  await saveMnemonic(walletAddress, mnemonic);
}
async function getWalletMnemonic(walletAddress) {
  const mnemonic = await getMnemonic(walletAddress);
  if (mnemonic) {
    return mnemonic;
  }
  const legacyMnemonic = await getLegacyMnemonic();
  if (legacyMnemonic) {
    const legacyAddress = addressFromMnemonic(legacyMnemonic);
    if (legacyAddress === walletAddress) {
      return legacyMnemonic;
    }
  }
  return null;
}
async function migrateToSecureStorage() {
  try {
    const keychainAvailable = await isKeychainAvailable();
    if (!keychainAvailable) {
      return { success: false, error: "OS keychain is not available on this system" };
    }
    const legacyMnemonic = await getLegacyMnemonic();
    if (!legacyMnemonic) {
      return { success: false, error: "No legacy configuration found to migrate" };
    }
    const address = addressFromMnemonic(legacyMnemonic);
    const alreadyMigrated = await hasMnemonic(address);
    if (alreadyMigrated) {
      const config2 = await loadConfig();
      if (config2) {
        config2.wallet.useKeychain = true;
        await saveConfig(config2);
      }
      return { success: true, address };
    }
    const migrated = await migrateToKeychain(address, legacyMnemonic);
    if (!migrated) {
      return { success: false, error: "Failed to store mnemonic in keychain" };
    }
    const config = await loadConfig();
    if (config) {
      config.wallet.address = address;
      config.wallet.useKeychain = true;
      await saveConfig(config);
    }
    return { success: true, address };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
function addressFromMnemonic(mnemonic) {
  const account = algosdk.mnemonicToSecretKey(mnemonic);
  return account.addr.toString();
}
function isValidMnemonic(mnemonic) {
  const words = mnemonic.trim().split(/\s+/);
  if (words.length !== 25) {
    return false;
  }
  try {
    algosdk.mnemonicToSecretKey(mnemonic);
    return true;
  } catch {
    return false;
  }
}
function buildConfig(builder) {
  const llmConfig = {
    mode: builder.llmMode || "api",
    provider: builder.llmProvider,
    model: builder.llmModel
  };
  if (builder.llmApiKey) {
    llmConfig.apiKey = builder.llmApiKey;
  }
  if (builder.llmBaseURL) {
    llmConfig.baseURL = builder.llmBaseURL;
  }
  return {
    llm: llmConfig,
    wallet: {
      address: builder.walletAddress,
      useKeychain: true
      // Always use keychain for new configs
    },
    payment: {
      preferredToken: builder.preferredToken
    },
    registryPath: builder.registryPath || DEFAULT_REGISTRY_PATH,
    registryAppId: builder.registryAppId,
    network: builder.network || "testnet"
  };
}
var DEFAULT_MODELS = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  anthropic: ["claude-sonnet-4-20250514", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"],
  gemini: ["gemini-2.0-flash", "gemini-1.5-pro-latest", "gemini-1.5-flash-latest"],
  groq: ["qwen/qwen3-32b", "llama-3.1-8b-instant", "llama-3.3-70b-versatile"]
};

// src/wallet.ts
import algosdk2 from "algosdk";
import { toClientAvmSigner } from "@x402-avm/avm";

// src/types.ts
var ALGORAND_TESTNET_CAIP2 = "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=";
var ALGORAND_MAINNET_CAIP2 = "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=";
var USDC_TESTNET_ASA_ID = 10458941;
var USDC_MAINNET_ASA_ID = 31566704;
var ALGOD_TESTNET_URL = "https://testnet-api.algonode.cloud";
var ALGOD_MAINNET_URL = "https://mainnet-api.algonode.cloud";
var INDEXER_TESTNET_URL = "https://testnet-idx.algonode.cloud";
var INDEXER_MAINNET_URL = "https://mainnet-idx.algonode.cloud";

// src/wallet.ts
function createWalletFromMnemonic(mnemonic) {
  const account = algosdk2.mnemonicToSecretKey(mnemonic);
  const privateKeyBase64 = Buffer.from(account.sk).toString("base64");
  const signer = toClientAvmSigner(privateKeyBase64);
  return {
    address: account.addr.toString(),
    secretKey: account.sk,
    signer
  };
}
function createAlgodClient(network) {
  const url = network === "testnet" ? ALGOD_TESTNET_URL : ALGOD_MAINNET_URL;
  return new algosdk2.Algodv2("", url, "");
}
async function getWalletBalance(address, network) {
  const algod = createAlgodClient(network);
  const usdcAsaId = network === "testnet" ? USDC_TESTNET_ASA_ID : USDC_MAINNET_ASA_ID;
  try {
    const info = await algod.accountInformation(address).do();
    let usdcBalance = 0n;
    let optedIntoUsdc = false;
    const assets = info.assets || [];
    for (const asset of assets) {
      if (asset.assetId === BigInt(usdcAsaId)) {
        usdcBalance = asset.amount;
        optedIntoUsdc = true;
        break;
      }
    }
    return {
      algo: info.amount,
      usdc: usdcBalance,
      minBalance: info.minBalance,
      optedIntoUsdc
    };
  } catch (error) {
    return {
      algo: 0n,
      usdc: 0n,
      minBalance: 100000n,
      // Default minimum balance
      optedIntoUsdc: false
    };
  }
}
function formatAmount(microunits, decimals = 6) {
  const divisor = BigInt(10 ** decimals);
  const whole = microunits / divisor;
  const fraction = microunits % divisor;
  if (fraction === 0n) {
    return whole.toString();
  }
  const fractionStr = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fractionStr}`;
}
function formatBalance(balance) {
  const algoFormatted = formatAmount(balance.algo);
  const usdcFormatted = balance.optedIntoUsdc ? formatAmount(balance.usdc) : "0 (not opted in)";
  const available = formatAmount(balance.algo - balance.minBalance);
  return {
    algo: algoFormatted,
    usdc: usdcFormatted,
    available
  };
}

// src/registry.ts
import algosdk3 from "algosdk";
import fs2 from "fs";
import path2 from "path";
import os2 from "os";
var DEFAULT_APP_ID = 769455464n;
var ARC4_RETURN_PREFIX = new Uint8Array([21, 31, 124, 117]);
function readAppIdFromConfig() {
  try {
    const configPath = path2.join(os2.homedir(), ".algope", "agent.json");
    const data = fs2.readFileSync(configPath, "utf-8");
    const config = JSON.parse(data);
    if (config.registryAppId) {
      return BigInt(config.registryAppId);
    }
  } catch {
  }
  return void 0;
}
function getRegistryAppId() {
  const envId = process.env.ALGOPE_REGISTRY_APP_ID;
  if (envId) {
    return BigInt(envId);
  }
  const configId = readAppIdFromConfig();
  if (configId) {
    return configId;
  }
  return DEFAULT_APP_ID;
}
function methodSelector(signature) {
  return algosdk3.ABIMethod.fromSignature(signature).getSelector();
}
function encodeArc4String(s) {
  const utf8 = new TextEncoder().encode(s);
  const buf = new Uint8Array(2 + utf8.length);
  new DataView(buf.buffer).setUint16(0, utf8.length, false);
  buf.set(utf8, 2);
  return buf;
}
function buildGetServiceArgs(selector, developerAddress, serviceName) {
  const addrBytes = algosdk3.decodeAddress(developerAddress).publicKey;
  const encodedName = encodeArc4String(serviceName);
  return [selector, addrBytes, encodedName];
}
function buildBoxKey(developerAddr, serviceName) {
  const prefix = new TextEncoder().encode("svc:");
  const senderBytes = algosdk3.decodeAddress(developerAddr).publicKey;
  const colon = new TextEncoder().encode(":");
  const nameBytes = new TextEncoder().encode(serviceName);
  const key = new Uint8Array(prefix.length + senderBytes.length + colon.length + nameBytes.length);
  let pos = 0;
  key.set(prefix, pos);
  pos += prefix.length;
  key.set(senderBytes, pos);
  pos += senderBytes.length;
  key.set(colon, pos);
  pos += colon.length;
  key.set(nameBytes, pos);
  return key;
}
function decodeServiceData(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const offsets = Array.from({ length: 8 }, (_, i) => view.getUint16(i * 2, false));
  const developer = algosdk3.encodeAddress(data.slice(16, 48));
  const createdAt = Number(view.getBigUint64(48, false));
  const updatedAt = Number(view.getBigUint64(56, false));
  const strings = offsets.map((off) => {
    const len = view.getUint16(off, false);
    return new TextDecoder().decode(data.slice(off + 2, off + 2 + len));
  });
  const [name, description, tagsStr, endpoint, pricePerRequest, paymentToken, walletAddress, network] = strings;
  return {
    id: `${developer}:${name}`,
    name,
    description,
    tags: tagsStr.split(",").map((t) => t.trim()).filter(Boolean),
    endpoint,
    pricePerRequest,
    paymentToken,
    walletAddress,
    network,
    createdAt: createdAt ? new Date(createdAt * 1e3).toISOString() : void 0,
    updatedAt: updatedAt ? new Date(updatedAt * 1e3).toISOString() : void 0
  };
}
async function fetchServiceOnChain(algod, appId, developerAddress, serviceName) {
  try {
    const sig = "getService(address,string)(string,string,string,string,string,string,string,string,address,uint64,uint64)";
    const selector = methodSelector(sig);
    const appArgs = buildGetServiceArgs(selector, developerAddress, serviceName);
    const boxKey = buildBoxKey(developerAddress, serviceName);
    const sp = await algod.getTransactionParams().do();
    const tx = algosdk3.makeApplicationNoOpTxnFromObject({
      sender: developerAddress,
      appIndex: appId,
      appArgs,
      boxes: [{ appIndex: appId, name: boxKey }],
      suggestedParams: sp
    });
    const encodedTxn = algosdk3.encodeUnsignedSimulateTransaction(tx);
    const signedTxn = algosdk3.decodeSignedTransaction(encodedTxn);
    const request = new algosdk3.modelsv2.SimulateRequest({
      txnGroups: [
        new algosdk3.modelsv2.SimulateRequestTransactionGroup({ txns: [signedTxn] })
      ],
      allowEmptySignatures: true,
      allowUnnamedResources: true,
      allowMoreLogging: true
    });
    const result = await algod.simulateTransactions(request).do();
    const logs = result.txnGroups?.[0]?.txnResults?.[0]?.txnResult?.logs ?? [];
    for (const log of logs) {
      if (log.length > 4 && log[0] === ARC4_RETURN_PREFIX[0] && log[1] === ARC4_RETURN_PREFIX[1] && log[2] === ARC4_RETURN_PREFIX[2] && log[3] === ARC4_RETURN_PREFIX[3]) {
        return decodeServiceData(log.slice(4));
      }
    }
    return null;
  } catch {
    return null;
  }
}
function filterServices(services, options) {
  let results = [...services];
  if (options.name) {
    const nl = options.name.toLowerCase();
    results = results.filter(
      (s) => s.name.toLowerCase().includes(nl) || s.description.toLowerCase().includes(nl)
    );
  }
  if (options.tags?.length) {
    const tl = options.tags.map((t) => t.toLowerCase());
    results = results.filter((s) => s.tags.some((tag) => tl.includes(tag.toLowerCase())));
  }
  if (options.paymentToken) {
    results = results.filter((s) => s.paymentToken === options.paymentToken);
  }
  if (options.network) {
    results = results.filter((s) => s.network === options.network);
  }
  if (options.maxPrice) {
    const max = parseFloat(options.maxPrice);
    results = results.filter((s) => parseFloat(s.pricePerRequest) <= max);
  }
  return results;
}
var RegistryClient = class {
  algod;
  indexer;
  appId;
  network;
  constructor(network = "testnet") {
    this.network = network;
    const algodUrl = network === "testnet" ? ALGOD_TESTNET_URL : ALGOD_MAINNET_URL;
    const indexerUrl = network === "testnet" ? INDEXER_TESTNET_URL : INDEXER_MAINNET_URL;
    this.algod = new algosdk3.Algodv2("", algodUrl, "");
    this.indexer = new algosdk3.Indexer("", indexerUrl, "");
    this.appId = getRegistryAppId();
  }
  /**
   * Fetches a specific service by developer address and name.
   */
  async findService(developerAddress, name) {
    const svc = await fetchServiceOnChain(this.algod, this.appId, developerAddress, name);
    return svc ?? void 0;
  }
  /**
   * Searches for a service by name across known developers.
   * Since box scanning is not directly supported without indexer,
   * this accepts an optional developer hint or searches the config.
   */
  async findByName(name, developerAddress) {
    if (!developerAddress) return void 0;
    const svc = await fetchServiceOnChain(this.algod, this.appId, developerAddress, name);
    return svc ?? void 0;
  }
  /**
   * Returns service info for a given developer + name.
   * Equivalent to getService on-chain.
   */
  async getService(developerAddress, name) {
    return this.findService(developerAddress, name);
  }
  /**
   * Returns all services for a developer (given a list of known service names).
   * Without an indexer, we need either a known list or a single name.
   */
  async listForDeveloper(developerAddress, serviceNames) {
    const results = await Promise.all(
      serviceNames.map(
        (name) => fetchServiceOnChain(this.algod, this.appId, developerAddress, name)
      )
    );
    return results.filter((s) => s !== null);
  }
  /**
   * Search services (requires a list of developer:name pairs to query).
   */
  async search(knownServices, options) {
    const results = await Promise.all(
      knownServices.map(
        ({ developer, name }) => fetchServiceOnChain(this.algod, this.appId, developer, name)
      )
    );
    const found = results.filter((s) => s !== null);
    return options ? filterServices(found, options) : found;
  }
  /**
   * Lists ALL services registered on-chain using Algorand Indexer.
   * This enumerates all boxes in the registry contract and fetches their details.
   * 
   * @returns Array of all available services
   * @throws Error if indexer is unavailable
   */
  async listAllServices() {
    try {
      const boxesResponse = await this.indexer.lookupApplicationBoxByIDandName(Number(this.appId), new Uint8Array()).do();
      const appId = Number(this.appId);
      const boxes = [];
      let nextToken;
      do {
        const params = {};
        if (nextToken) params.next = nextToken;
        const response2 = await this.indexer.lookupApplicationBoxByIDandName(appId, new Uint8Array()).do().catch(() => null);
        if (!response2) break;
        break;
      } while (nextToken);
      const indexerUrl = this.network === "testnet" ? INDEXER_TESTNET_URL : INDEXER_MAINNET_URL;
      const boxesUrl = `${indexerUrl}/v2/applications/${this.appId}/boxes`;
      const response = await fetch(boxesUrl);
      if (!response.ok) {
        throw new Error(`Indexer API error: ${response.status} ${response.statusText}`);
      }
      const data = await response.json();
      const servicePromises = [];
      for (const box of data.boxes) {
        try {
          const boxKeyBytes = Buffer.from(box.name, "base64");
          const prefix = boxKeyBytes.slice(0, 4).toString("utf-8");
          if (prefix !== "svc:") continue;
          if (boxKeyBytes.length < 4 + 32 + 1) continue;
          const pubkeyBytes = boxKeyBytes.slice(4, 36);
          if (pubkeyBytes.length !== 32) continue;
          if (boxKeyBytes[36] !== 58) continue;
          const serviceName = boxKeyBytes.slice(37).toString("utf-8");
          if (!serviceName) continue;
          const developerAddress = algosdk3.encodeAddress(pubkeyBytes);
          servicePromises.push(
            fetchServiceOnChain(this.algod, this.appId, developerAddress, serviceName)
          );
        } catch (error) {
          console.warn(`Failed to parse box key: ${box.name}`, error);
          continue;
        }
      }
      const services = await Promise.all(servicePromises);
      return services.filter((s) => s !== null);
    } catch (error) {
      console.error("Failed to list services from indexer:", error);
      throw new Error(
        `Could not fetch services from Algorand Indexer. Please ensure indexer is available or use --provider flag. Error: ${error.message}`
      );
    }
  }
  /** App ID of the registry contract. */
  getAppId() {
    return this.appId;
  }
};

// src/agent.ts
import { generateText, stepCountIs, tool as tool4 } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOllama } from "ai-sdk-ollama";
import { z as z4 } from "zod";

// src/payment.ts
import { x402Client } from "@x402-avm/core/client";
import { x402HTTPClient } from "@x402-avm/core/http";
import { registerExactAvmScheme } from "@x402-avm/avm/exact/client";

// src/x402/algo/client-scheme.ts
import algosdk4 from "algosdk";
var AlgoNativeClientScheme = class {
  constructor(config) {
    this.config = config;
  }
  config;
  scheme = "algo-exact";
  /**
   * Creates a payment payload for the algo-exact scheme
   */
  async createPaymentPayload(x402Version, paymentRequirements) {
    const { amount, payTo, network } = paymentRequirements;
    const suggestedParams = await this.config.algodClient.getTransactionParams().do();
    const paymentTxn = algosdk4.makePaymentTxnWithSuggestedParamsFromObject({
      sender: this.config.address,
      receiver: payTo,
      amount: BigInt(amount),
      // Amount already in microALGO
      note: new Uint8Array(Buffer.from(`x402-payment-v${x402Version}-${Date.now()}`)),
      suggestedParams
    });
    const encodedTxn = algosdk4.encodeUnsignedTransaction(paymentTxn);
    console.log("[x402 ALGO Client] Creating payment:", {
      sender: this.config.address,
      receiver: payTo,
      amount: amount.toString(),
      network,
      txnType: "pay"
    });
    const signedTxns = await this.config.signer.signTransactions([encodedTxn], [0]);
    const signedTxn = signedTxns[0];
    if (!signedTxn) {
      throw new Error("Failed to sign ALGO payment transaction");
    }
    console.log("[x402 ALGO Client] Transaction signed successfully");
    const paymentGroup = [Buffer.from(signedTxn).toString("base64")];
    const payload = {
      paymentGroup,
      paymentIndex: 0
      // Always 0 for single payment
    };
    return {
      x402Version,
      payload
    };
  }
};
function createAlgodClient2(network) {
  const isTestnet = network.includes("SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=") || network.includes("testnet");
  const algodUrl = isTestnet ? "https://testnet-api.algonode.cloud" : "https://mainnet-api.algonode.cloud";
  return new algosdk4.Algodv2("", algodUrl, "");
}

// src/payment.ts
var PaymentClient = class {
  wallet;
  coreClient;
  httpClient;
  network;
  onPayment;
  receipts = [];
  totalSpent = {
    ALGO: 0n,
    USDC: 0n
  };
  constructor(options) {
    this.wallet = createWalletFromMnemonic(options.mnemonic);
    this.network = options.network || "testnet";
    this.onPayment = options.onPayment;
    this.coreClient = new x402Client();
    const networkCaip2 = this.network === "testnet" ? ALGORAND_TESTNET_CAIP2 : ALGORAND_MAINNET_CAIP2;
    const algodClient = createAlgodClient2(networkCaip2);
    const algoScheme = new AlgoNativeClientScheme({
      algodClient,
      signer: this.wallet.signer,
      address: this.wallet.address
    });
    this.coreClient.register(networkCaip2, algoScheme);
    registerExactAvmScheme(this.coreClient, {
      signer: this.wallet.signer,
      networks: [networkCaip2],
      algodConfig: {
        algodUrl: this.network === "testnet" ? ALGOD_TESTNET_URL : ALGOD_MAINNET_URL
      }
    });
    this.httpClient = new x402HTTPClient(this.coreClient);
  }
  /**
   * Gets the wallet address
   */
  getAddress() {
    return this.wallet.address;
  }
  /**
   * Makes an HTTP request with automatic x402 payment handling
   */
  async fetch(url, options = {}) {
    const { method = "GET", headers = {}, body, timeout = 3e4 } = options;
    const fetchOptions = {
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers
      },
      signal: AbortSignal.timeout(timeout)
    };
    if (body && method !== "GET") {
      fetchOptions.body = JSON.stringify(body);
    }
    let response = await fetch(url, fetchOptions);
    if (response.status === 402) {
      const paymentRequired = this.httpClient.getPaymentRequiredResponse(
        (name) => response.headers.get(name),
        await response.clone().json().catch(() => void 0)
      );
      const paymentPayload = await this.httpClient.createPaymentPayload(paymentRequired);
      const paymentHeaders = this.httpClient.encodePaymentSignatureHeader(paymentPayload);
      const retryOptions = {
        ...fetchOptions,
        headers: {
          ...fetchOptions.headers,
          ...paymentHeaders
        }
      };
      response = await fetch(url, retryOptions);
      const settlement = this.readSettlement(response);
      const receipt = this.recordPayment(url, paymentRequired, settlement);
      const data2 = await this.parseResponse(response);
      return {
        status: response.status,
        statusText: response.statusText,
        headers: this.headersToObject(response.headers),
        data: data2,
        paid: true,
        paymentReceipt: receipt
      };
    }
    const data = await this.parseResponse(response);
    return {
      status: response.status,
      statusText: response.statusText,
      headers: this.headersToObject(response.headers),
      data,
      paid: false
    };
  }
  /**
   * Makes a request to a known paid service
   */
  async callService(service, path5 = "/", options = {}) {
    const url = new URL(path5, service.endpoint).toString();
    return this.fetch(url, options);
  }
  /**
   * Records a payment
   */
  /**
   * Reads the settlement result the resource server attaches to the paid
   * response. Never throws: a receipt without a txid is still worth recording.
   */
  readSettlement(response) {
    try {
      const settle = this.httpClient.getPaymentSettleResponse(
        (name) => response.headers.get(name)
      );
      return settle;
    } catch {
      return void 0;
    }
  }
  recordPayment(url, paymentRequired, settlement) {
    const accepts = paymentRequired.accepts;
    const firstOption = Array.isArray(accepts) ? accepts[0] : accepts;
    const scheme = firstOption.scheme || "exact";
    const token = scheme === "algo-exact" ? "ALGO" : "USDC";
    const amount = firstOption.amount || firstOption.maxAmountRequired || firstOption.value || "0";
    const receipt = {
      txId: settlement?.transaction,
      amount: formatAmount(BigInt(amount)),
      token,
      recipient: firstOption.payTo || "unknown",
      timestamp: /* @__PURE__ */ new Date(),
      service: firstOption.description || "Unknown Service",
      path: new URL(url).pathname
    };
    this.totalSpent[token] += BigInt(amount);
    this.receipts.push(receipt);
    if (this.onPayment) {
      this.onPayment(receipt);
    }
    return receipt;
  }
  /**
   * Gets all payment receipts
   */
  getReceipts() {
    return [...this.receipts];
  }
  /**
   * Gets total spent by token
   */
  getTotalSpent() {
    return {
      ALGO: formatAmount(this.totalSpent.ALGO),
      USDC: formatAmount(this.totalSpent.USDC)
    };
  }
  /**
   * Gets transaction count
   */
  getTransactionCount() {
    return this.receipts.length;
  }
  /**
   * Resets payment tracking
   */
  reset() {
    this.receipts = [];
    this.totalSpent = { ALGO: 0n, USDC: 0n };
  }
  /**
   * Parses response body
   */
  async parseResponse(response) {
    const contentType = response.headers.get("Content-Type") || "";
    if (contentType.includes("application/json")) {
      return await response.json();
    }
    return await response.text();
  }
  /**
   * Converts Headers to plain object
   */
  headersToObject(headers) {
    const obj = {};
    headers.forEach((value, key) => {
      obj[key] = value;
    });
    return obj;
  }
};

// src/tools/discoverService.ts
import { tool } from "ai";
import { z } from "zod";
import * as fs3 from "fs/promises";
import * as path3 from "path";
import * as os3 from "os";
async function loadLocalRegistry() {
  try {
    const registryPath = path3.join(os3.homedir(), ".algope", "registry.json");
    const content = await fs3.readFile(registryPath, "utf-8");
    const registry = JSON.parse(content);
    return registry.services || [];
  } catch {
    return [];
  }
}
async function getLocalDeveloperAddress() {
  try {
    const configPath = path3.join(os3.homedir(), ".algope", "config.json");
    const content = await fs3.readFile(configPath, "utf-8");
    const config = JSON.parse(content);
    return config.walletAddress;
  } catch {
    return void 0;
  }
}
async function getLocalServiceName() {
  try {
    const configPath = path3.join(os3.homedir(), ".algope", "config.json");
    const content = await fs3.readFile(configPath, "utf-8");
    const config = JSON.parse(content);
    return config.serviceName;
  } catch {
    return void 0;
  }
}
function filterServices2(services, options) {
  let results = [...services];
  if (options.query || options.tags?.length) {
    const queryWords = options.query ? options.query.toLowerCase().split(/\s+/).filter((w) => w.length > 1) : [];
    const searchTags = options.tags ? options.tags.map((t) => t.toLowerCase()) : [];
    results = results.filter((s) => {
      const searchText = `${s.name} ${s.description} ${s.tags.join(" ")}`.toLowerCase();
      const queryMatch = queryWords.length === 0 || queryWords.some((word) => searchText.includes(word));
      const tagMatch = searchTags.length === 0 || s.tags.some(
        (t) => searchTags.some((st) => t.toLowerCase().includes(st) || st.includes(t.toLowerCase()))
      );
      return queryMatch || tagMatch;
    });
  }
  if (options.paymentToken) {
    results = results.filter((s) => s.paymentToken === options.paymentToken);
  }
  if (options.maxPrice) {
    const max = parseFloat(options.maxPrice);
    results = results.filter((s) => parseFloat(s.pricePerRequest) <= max);
  }
  return results;
}
function createDiscoverServiceTool(options) {
  const { registryClient } = options;
  return tool({
    description: "Search for AI services in the AlgoPe marketplace. Use this to find services that can help with a task. Returns service names, descriptions, prices, and endpoints.",
    inputSchema: z.object({
      query: z.string().optional().describe("Search query to match against service names and descriptions"),
      tags: z.array(z.string()).optional().describe("Filter by tags (e.g., ['ai', 'research', 'nlp'])"),
      maxPrice: z.string().optional().describe("Maximum price per request (e.g., '0.1')"),
      paymentToken: z.enum(["ALGO", "USDC"]).optional().describe("Filter by payment token")
    }),
    execute: async ({ query, tags, maxPrice, paymentToken }) => {
      try {
        let allServices = [];
        try {
          allServices = await registryClient.listAllServices();
        } catch (indexerError) {
          const localServices = await loadLocalRegistry();
          if (localServices.length > 0) {
            allServices = localServices;
          } else {
            const developerAddr = await getLocalDeveloperAddress();
            const serviceName = await getLocalServiceName();
            if (developerAddr && serviceName) {
              const localProviderService = await registryClient.findService(developerAddr, serviceName);
              if (localProviderService) {
                allServices = [localProviderService];
              }
            }
          }
        }
        const filtered = filterServices2(allServices, { query, tags, maxPrice, paymentToken });
        if (filtered.length === 0) {
          return {
            found: false,
            message: allServices.length === 0 ? "No services found in registry. Make sure services are registered on-chain." : "No services found matching your criteria.",
            services: []
          };
        }
        const sorted = filtered.sort((a, b) => {
          if (!query) return 0;
          const qLower = query.toLowerCase();
          const aNameMatch = a.name.toLowerCase() === qLower;
          const bNameMatch = b.name.toLowerCase() === qLower;
          if (aNameMatch && !bNameMatch) return -1;
          if (!aNameMatch && bNameMatch) return 1;
          return 0;
        });
        return {
          found: true,
          message: `Found ${sorted.length} service(s)${allServices.length !== sorted.length ? ` (${allServices.length} total available)` : ""}`,
          services: sorted.map((s) => ({
            name: s.name,
            description: s.description,
            price: `${s.pricePerRequest} ${s.paymentToken}`,
            tags: s.tags,
            endpoint: s.endpoint
          }))
        };
      } catch (error) {
        return {
          found: false,
          message: `Error discovering services: ${error.message}`,
          services: []
        };
      }
    }
  });
}

// src/tools/callPaidApi.ts
import { tool as tool2 } from "ai";
import { z as z2 } from "zod";
import * as fs4 from "fs/promises";
import * as path4 from "path";
import * as os4 from "os";
var paidCallCache = /* @__PURE__ */ new Map();
function resetPaidCallCache() {
  paidCallCache.clear();
}
async function findServiceByName(name) {
  try {
    const registryPath = path4.join(os4.homedir(), ".algope", "registry.json");
    const content = await fs4.readFile(registryPath, "utf-8");
    const registry = JSON.parse(content);
    return registry.services?.find(
      (s) => s.name.toLowerCase() === name.toLowerCase()
    );
  } catch {
    return void 0;
  }
}
async function getLocalDeveloperAddress2() {
  try {
    const configPath = path4.join(os4.homedir(), ".algope", "config.json");
    const content = await fs4.readFile(configPath, "utf-8");
    const config = JSON.parse(content);
    return config.walletAddress;
  } catch {
    return void 0;
  }
}
function createCallPaidApiTool(options) {
  const { paymentClient, registryClient, providerHint } = options;
  return tool2({
    description: "Call a paid AI service API. This tool automatically handles x402 payments on Algorand. Use the 'discoverService' tool first to find available services.",
    inputSchema: z2.object({
      serviceName: z2.string().describe("The name of the service to call (from discoverService results)"),
      path: z2.string().optional().default("/").describe("API path to call (default: '/')"),
      method: z2.enum(["GET", "POST", "PUT", "DELETE"]).optional().default("POST").describe("HTTP method"),
      body: z2.record(z2.unknown()).optional().describe("Request body (for POST/PUT requests)")
    }),
    execute: async ({ serviceName, path: path5, method, body }) => {
      let effectivePath = path5 || "/";
      if (effectivePath.startsWith("http://") || effectivePath.startsWith("https://")) {
        try {
          const url = new URL(effectivePath);
          effectivePath = url.pathname + url.search;
        } catch {
          effectivePath = "/";
        }
      }
      if (effectivePath === "/" || effectivePath === "") {
        const svcLower = serviceName.toLowerCase();
        if (["btc", "eth", "sol", "algo", "avax"].includes(svcLower)) {
          effectivePath = `/crypto?symbol=${serviceName.toUpperCase()}`;
        } else if (svcLower.includes("bitcoin")) {
          effectivePath = "/btc";
        } else if (svcLower.includes("weather")) {
          effectivePath = "/weather?city=New%20York";
        } else if (svcLower.includes("market")) {
          effectivePath = "/market/summary";
        }
      }
      const cacheKey = `${serviceName.toLowerCase()}:${effectivePath}:${method}`;
      console.log(`[callPaidApi] Cache check - key: "${cacheKey}", cached: ${paidCallCache.has(cacheKey)}`);
      const cachedResult = paidCallCache.get(cacheKey);
      if (cachedResult) {
        console.log(`[callPaidApi] \u2713 Returning cached result for "${serviceName}" (preventing duplicate payment)`);
        return {
          success: cachedResult.success,
          data: cachedResult.data,
          paid: false,
          // Not paying again
          cached: true,
          note: "Result from previous call - no additional payment made"
        };
      }
      console.log(`[callPaidApi] No cache hit - proceeding with API call for "${serviceName}"`);
      const namesToTry = providerHint ? [providerHint, serviceName] : [serviceName];
      let service;
      for (const nameToTry of namesToTry) {
        service = await findServiceByName(nameToTry);
        if (!service) {
          const developerAddr = await getLocalDeveloperAddress2();
          if (developerAddr) {
            service = await registryClient.findByName(nameToTry, developerAddr);
          }
        }
        if (service) {
          break;
        }
      }
      if (!service) {
        return {
          success: false,
          error: `Service "${serviceName}" not found in registry`,
          suggestion: "Use the discoverService tool to find available services"
        };
      }
      try {
        const response = await paymentClient.callService(service, effectivePath, {
          method,
          body
        });
        paidCallCache.set(cacheKey, {
          success: true,
          data: response.data,
          paid: response.paid ?? false
        });
        return {
          success: true,
          status: response.status,
          data: response.data,
          paid: response.paid,
          payment: response.paymentReceipt ? {
            amount: response.paymentReceipt.amount,
            token: response.paymentReceipt.token,
            recipient: response.paymentReceipt.recipient
          } : void 0
        };
      } catch (error) {
        return {
          success: false,
          error: `API call failed: ${error.message}`,
          serviceName,
          endpoint: service.endpoint
        };
      }
    }
  });
}

// src/tools/callFreeApi.ts
import { tool as tool3 } from "ai";
import { z as z3 } from "zod";
function createCallFreeApiTool() {
  return tool3({
    description: "Call a free HTTP API (no payment required). Use this for public APIs that don't require x402 payments.",
    inputSchema: z3.object({
      url: z3.string().url().describe("The full URL to call"),
      method: z3.enum(["GET", "POST", "PUT", "DELETE"]).optional().default("GET").describe("HTTP method"),
      headers: z3.record(z3.string()).optional().describe("Additional headers to send"),
      body: z3.record(z3.unknown()).optional().describe("Request body (for POST/PUT requests)")
    }),
    execute: async ({ url, method, headers, body }) => {
      try {
        const fetchOptions = {
          method: method || "GET",
          headers: {
            "Content-Type": "application/json",
            ...headers || {}
          },
          signal: AbortSignal.timeout(3e4)
        };
        if (body && method !== "GET") {
          fetchOptions.body = JSON.stringify(body);
        }
        const response = await fetch(url, fetchOptions);
        const contentType = response.headers.get("Content-Type") || "";
        let data;
        if (contentType.includes("application/json")) {
          data = await response.json();
        } else {
          data = await response.text();
        }
        return {
          success: response.ok,
          status: response.status,
          statusText: response.statusText,
          data
        };
      } catch (error) {
        return {
          success: false,
          error: `Request failed: ${error.message}`,
          url
        };
      }
    }
  });
}

// src/agent.ts
var AlgoPeAgent = class _AlgoPeAgent {
  config = null;
  registryClient = null;
  paymentClient = null;
  verbose;
  initialized = false;
  constructor(options = {}) {
    this.config = options.config || null;
    this.verbose = options.verbose || false;
  }
  /**
   * Initializes the agent (loads config if not provided)
   * Retrieves wallet mnemonic securely from OS keychain
   */
  async ensureInitialized() {
    if (this.initialized) return;
    if (!this.config) {
      const loaded = await loadConfig();
      if (!loaded) {
        throw new Error(
          "No agent configuration found. Run 'algope-agent init' first."
        );
      }
      this.config = loaded;
    }
    this.registryClient = new RegistryClient(
      this.config.network || "testnet"
    );
    const mnemonic = await getWalletMnemonic(this.config.wallet.address);
    if (!mnemonic) {
      throw new Error(
        `Wallet mnemonic not found in OS keychain for address: ${this.config.wallet.address}
Run 'algope-agent init' to set up your wallet, or 'algope-agent migrate-keychain' to migrate from legacy plaintext storage.`
      );
    }
    this.paymentClient = new PaymentClient({
      mnemonic,
      network: this.config.network || "testnet"
    });
    this.initialized = true;
  }
  /**
   * Creates the LLM model instance
   */
  createModel() {
    if (!this.config) {
      throw new Error("Agent not initialized");
    }
    const { mode, provider, model, apiKey, baseURL } = this.config.llm;
    let resolvedModel = model;
    if (provider === "gemini") {
      if (model === "gemini-1.5-pro") {
        resolvedModel = "gemini-1.5-pro-latest";
      } else if (model === "gemini-1.5-flash") {
        resolvedModel = "gemini-1.5-flash-latest";
      } else if (model === "gemini-2.0-flash-exp") {
        resolvedModel = "gemini-2.0-flash";
      }
    }
    if (mode === "local") {
      let ollamaHost = "http://localhost:11434";
      if (baseURL) {
        ollamaHost = baseURL.replace(/\/v1\/?$/, "");
      }
      const ollama = createOllama({
        baseURL: ollamaHost
      });
      return ollama(resolvedModel);
    }
    if (!apiKey) {
      throw new Error("API mode requires apiKey to be configured");
    }
    if (provider === "openai") {
      const openai = createOpenAI({ apiKey, baseURL });
      return openai.chat(resolvedModel);
    } else if (provider === "groq") {
      const groq = createOpenAI({
        apiKey,
        baseURL: "https://api.groq.com/openai/v1",
        name: "groq"
      });
      return groq.chat(resolvedModel);
    } else if (provider === "anthropic") {
      const anthropic = createAnthropic({ apiKey });
      return anthropic(resolvedModel);
    } else if (provider === "gemini") {
      const google = createGoogleGenerativeAI({ apiKey });
      return google(resolvedModel);
    }
    throw new Error(`Unsupported LLM provider: ${provider}`);
  }
  /**
   * Creates the tools for the agent
   */
  createTools(options = {}) {
    if (!this.registryClient || !this.paymentClient) {
      throw new Error("Agent not initialized");
    }
    const { includeDiscover = true, includeFree = true, providerHint } = options;
    const tools = {
      callPaidApi: createCallPaidApiTool({
        paymentClient: this.paymentClient,
        registryClient: this.registryClient,
        providerHint
      })
    };
    if (includeDiscover) {
      tools.discoverService = createDiscoverServiceTool({
        registryClient: this.registryClient
      });
    }
    if (includeFree) {
      tools.callFreeApi = createCallFreeApiTool();
    }
    return tools;
  }
  createFallbackTools() {
    return {
      callPaidApi: tool4({
        description: "Call a paid marketplace service by name. Use serviceName and optional path/method/body.",
        inputSchema: z4.object({
          serviceName: z4.string(),
          path: z4.string().optional().default("/"),
          method: z4.enum(["GET", "POST", "PUT", "DELETE"]).optional().default("GET"),
          body: z4.record(z4.unknown()).optional()
        }),
        execute: async ({ serviceName, path: path5, method, body }) => {
          if (!this.paymentClient || !this.registryClient) {
            return { success: false, error: "Payment client not initialized" };
          }
          try {
            const fs5 = await import("fs/promises");
            const os5 = await import("os");
            const pathMod = await import("path");
            let service = null;
            try {
              const configPath = pathMod.join(os5.homedir(), ".algope", "config.json");
              const configContent = await fs5.readFile(configPath, "utf-8");
              const config = JSON.parse(configContent);
              if (config.serviceName === serviceName || config.serviceName.toLowerCase() === serviceName.toLowerCase()) {
                service = {
                  id: `onchain:${config.walletAddress}:${config.serviceName}`,
                  name: config.serviceName,
                  description: config.serviceDescription || "Provider service",
                  tags: config.tags || [],
                  endpoint: `http://localhost:${config.proxyPort || 4402}`,
                  pricePerRequest: config.pricePerRequest || "0.05",
                  paymentToken: config.paymentToken,
                  walletAddress: config.walletAddress,
                  network: config.network
                };
              }
            } catch {
            }
            if (!service) {
              service = {
                id: `local:${serviceName}`,
                name: serviceName,
                description: "Local fallback service",
                tags: ["local", "fallback"],
                endpoint: "http://localhost:4402",
                pricePerRequest: "0.05",
                paymentToken: "ALGO",
                walletAddress: "",
                network: "testnet"
              };
            }
            const localPath = path5?.startsWith("/") ? path5 : `/${path5 ?? ""}`;
            const response = await this.paymentClient.callService(service, localPath || "/", {
              method,
              body
            });
            return {
              success: true,
              status: response.status,
              data: response.data,
              paid: response.paid,
              payment: response.paymentReceipt ? {
                amount: response.paymentReceipt.amount,
                token: response.paymentReceipt.token,
                recipient: response.paymentReceipt.recipient
              } : void 0
            };
          } catch (error) {
            return {
              success: false,
              error: `API call failed: ${error.message}`
            };
          }
        }
      })
    };
  }
  /**
   * Runs a task with the agent
   */
  async run(task, options = {}) {
    const startTime = Date.now();
    await this.ensureInitialized();
    resetPaidCallCache();
    const { provider, maxSteps = 10, onStep, onPayment } = options;
    const effectiveMaxSteps = provider ? Math.min(maxSteps, 3) : maxSteps;
    if (onPayment && this.paymentClient) {
      this.paymentClient.reset();
    }
    const steps = [];
    let stepNumber = 0;
    try {
      const includeDiscover = !provider;
      const includeFree = false;
      let systemPrompt = `You are an AI assistant that MUST use the AlgoPe paid marketplace for all data services.

MANDATORY WORKFLOW - YOU MUST FOLLOW THESE STEPS IN ORDER:
1. FIRST: Call 'discoverService' with a simple query (e.g., "bitcoin" or "weather" - use single keywords).
2. SECOND: Review the services returned. Select the BEST match based on name and description.
3. THIRD: Call 'callPaidApi' with:
   - serviceName: the EXACT name from discovery (e.g., "BTC" not "bitcoin-service")
   - path: the correct API path with query parameters
   - method: "GET" for data retrieval

CRITICAL API PATHS - USE THESE EXACT PATHS:
- Bitcoin/crypto prices: path="/crypto?symbol=BTC" (or ETH, SOL, ALGO, AVAX)
- Stock prices: path="/stock?symbol=AAPL" (or any stock ticker)
- Market summary: path="/market/summary"
- Weather data: path="/weather?city=London" (or any city name)

IMPORTANT:
- All payments happen automatically via x402 on Algorand - no user approval needed.
- Service names are SHORT like "BTC", "Weather", "Sam" - use exactly what discoverService returns.
- ALWAYS include the full path with query parameters (e.g., "/crypto?symbol=BTC" NOT just "/")
- Do NOT skip the discovery step. You must discover first to find available services.
- CRITICAL: Call 'callPaidApi' ONLY ONCE per user request. Each call costs real money. After receiving the API response, immediately provide the answer to the user - do NOT call the API again.`;
      if (includeDiscover) {
        systemPrompt += `

Your first action MUST be to call 'discoverService' with a simple keyword like "bitcoin" or "crypto".`;
      }
      if (provider) {
        systemPrompt = `You are a helpful AI assistant with access to paid AI services on the AlgoPe marketplace.

CRITICAL INSTRUCTION: The user has specified to use ONLY the service with the EXACT name "${provider}".
You MUST call 'callPaidApi' with serviceName="${provider}" (use this exact string, do not modify or rename it).
Determine the appropriate API path and method based on the task.
Make exactly one paid call unless the user explicitly asks for multiple calls.
DO NOT use 'discoverService' or 'callFreeApi' when a provider is specified.
Provide a clear answer based on the API response.`;
      }
      const model = this.createModel();
      const tools = this.createTools({
        includeDiscover,
        includeFree,
        providerHint: provider
      });
      let result = await generateText({
        model,
        tools,
        stopWhen: stepCountIs(effectiveMaxSteps),
        system: systemPrompt,
        prompt: task,
        onStepFinish: (event) => {
          stepNumber++;
          const stepInfo = {
            stepNumber,
            text: event.text
          };
          if (event.toolCalls && event.toolCalls.length > 0) {
            const toolCall = event.toolCalls[0];
            stepInfo.toolName = toolCall.toolName;
            stepInfo.toolArgs = toolCall.input;
          }
          if (event.toolResults && event.toolResults.length > 0) {
            const toolResult = event.toolResults[0];
            stepInfo.toolResult = toolResult.output;
          }
          steps.push(stepInfo);
          if (onStep) {
            onStep(stepInfo);
          }
          if (this.verbose) {
            console.log(`Step ${stepNumber}:`, stepInfo.toolName || "text");
          }
        }
      });
      if (provider && steps.length === 1 && !steps[0]?.toolName) {
        const fallbackPrompt = `Use callPaidApi with serviceName "${provider}". Analyze the task and choose the appropriate path and method.`;
        result = await generateText({
          model,
          tools: this.createFallbackTools(),
          stopWhen: stepCountIs(2),
          system: "You must call callPaidApi exactly once and then return the result.",
          prompt: fallbackPrompt,
          onStepFinish: (event) => {
            stepNumber++;
            const stepInfo = {
              stepNumber,
              text: event.text
            };
            if (event.toolCalls && event.toolCalls.length > 0) {
              const toolCall = event.toolCalls[0];
              stepInfo.toolName = toolCall.toolName;
              stepInfo.toolArgs = toolCall.input;
            }
            if (event.toolResults && event.toolResults.length > 0) {
              const toolResult = event.toolResults[0];
              stepInfo.toolResult = toolResult.output;
            }
            steps.push(stepInfo);
            if (onStep) onStep(stepInfo);
          }
        });
      }
      const payments = {
        totalSpent: this.paymentClient?.getTotalSpent() || { ALGO: "0", USDC: "0" },
        transactionCount: this.paymentClient?.getTransactionCount() || 0,
        receipts: this.paymentClient?.getReceipts() || []
      };
      if (onPayment && payments.receipts.length > 0) {
        for (const receipt of payments.receipts) {
          onPayment(receipt);
        }
      }
      return {
        text: result.text,
        success: true,
        steps,
        payments,
        duration: Date.now() - startTime
      };
    } catch (error) {
      return {
        text: "",
        success: false,
        steps,
        payments: {
          totalSpent: { ALGO: "0", USDC: "0" },
          transactionCount: 0,
          receipts: []
        },
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }
  /**
   * Gets the wallet address
   */
  async getWalletAddress() {
    await this.ensureInitialized();
    return this.paymentClient.getAddress();
  }
  /**
   * Lists available services
   */
  async listServices() {
    await this.ensureInitialized();
    return [];
  }
  /**
   * Gets the current configuration
   */
  getConfig() {
    return this.config;
  }
  /**
   * Creates a AlgoPe agent from saved configuration
   * Convenience factory method for SDK users
   */
  static async fromConfig() {
    const config = await loadConfig();
    if (!config) {
      throw new Error(
        "No agent configuration found. Run 'algope-agent init' first."
      );
    }
    const agent = new _AlgoPeAgent({ config });
    await agent.ensureInitialized();
    return agent;
  }
};

// src/cli.ts
var VERSION = "1.0.0";
var DEFAULT_REGISTRY_APP_ID = "769455464";
var agentGradient = gradient(["#FF6B6B", "#4ECDC4", "#45B7D1"]);
function printBanner() {
  console.log();
  console.log(
    agentGradient.multiline(`
   _____ _           _       _____         _____            _   
  / ____| |         (_)     |  __ \\       / ____|          | |  
 | |    | |__   __ _ _ _ __ | |__) |___  | |  __  ___ _ __ | |_ 
 | |    | '_ \\ / _\` | | '_ \\|  ___/ _ \\ | | |_ |/ _ \\ '_ \\| __|
 | |____| | | | (_| | | | | | |  |  __/ | |__| |  __/ | | | |_ 
  \\_____|_| |_|\\__,_|_|_| |_|_|   \\___|  \\_____|\\___|_| |_|\\__|
`)
  );
  console.log(
    chalk.gray("  Pre-built AI Agent with x402 Payments on Algorand")
  );
  console.log();
}
function printSection(title) {
  console.log();
  console.log(chalk.cyan.bold(`\u25B8 ${title}`));
  console.log(chalk.gray("\u2500".repeat(50)));
}
function validateApiKey(value) {
  if (!value || value.length < 10) {
    return "Please enter a valid API key";
  }
  return void 0;
}
function validateMnemonicInput(value) {
  if (!value) return "Mnemonic is required";
  if (!isValidMnemonic(value)) {
    return "Please enter a valid 25-word Algorand mnemonic";
  }
  return void 0;
}
async function runInit() {
  printBanner();
  p.intro(chalk.bgMagenta.black(" AlgoPe Agent Setup "));
  const keychainAvailable = await isKeychainAvailable();
  if (!keychainAvailable) {
    console.log(chalk.red("\n  \u26A0 OS Keychain is not available on this system."));
    console.log(chalk.yellow("    Your wallet mnemonic cannot be stored securely."));
    console.log(chalk.gray("    Please ensure you have proper system credentials configured."));
    p.cancel("Setup failed - keychain unavailable");
    process.exit(1);
  }
  console.log(chalk.green("\n  \u2713 OS Keychain available - your wallet will be stored securely"));
  const existingConfig = await loadConfig();
  if (existingConfig) {
    const shouldOverwrite = await p.confirm({
      message: "Configuration already exists. Overwrite?",
      initialValue: false
    });
    if (p.isCancel(shouldOverwrite) || !shouldOverwrite) {
      p.cancel("Setup cancelled");
      process.exit(0);
    }
  }
  printSection("LLM Configuration");
  const llmMode = await p.select({
    message: "LLM Mode",
    options: [
      { value: "local", label: "Local (Ollama)", hint: "Free, runs on your machine" },
      { value: "api", label: "API (OpenAI/Anthropic/Gemini)", hint: "Cloud-based, requires API key" }
    ]
  });
  if (p.isCancel(llmMode)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }
  const mode = llmMode;
  let provider;
  let llmModel;
  let llmApiKey = "";
  let llmBaseURL = "";
  if (mode === "local") {
    console.log(chalk.gray("\n  Using Ollama for local LLM."));
    console.log(chalk.gray("  Make sure Ollama is running: brew services start ollama"));
    console.log();
    provider = "openai";
    const baseURL = await p.text({
      message: "Ollama Base URL",
      initialValue: "http://localhost:11434/v1",
      placeholder: "http://localhost:11434/v1"
    });
    if (p.isCancel(baseURL)) {
      p.cancel("Setup cancelled");
      process.exit(0);
    }
    llmBaseURL = baseURL;
    const modelName = await p.text({
      message: "Model Name",
      initialValue: "qwen2.5:7b",
      placeholder: "qwen2.5:7b"
    });
    if (p.isCancel(modelName)) {
      p.cancel("Setup cancelled");
      process.exit(0);
    }
    llmModel = modelName;
    llmApiKey = "ollama";
  } else {
    const llmProvider = await p.select({
      message: "LLM Provider",
      options: [
        { value: "groq", label: "Groq", hint: "Llama 3.3, fast inference" },
        { value: "openai", label: "OpenAI", hint: "GPT-4o, GPT-4 Turbo" },
        { value: "anthropic", label: "Anthropic", hint: "Claude 3.5 Sonnet, Claude 3 Opus" },
        { value: "gemini", label: "Google Gemini", hint: "Gemini 2.0 Flash, Gemini 1.5 Pro" }
      ]
    });
    if (p.isCancel(llmProvider)) {
      p.cancel("Setup cancelled");
      process.exit(0);
    }
    provider = llmProvider;
    const modelOptions = DEFAULT_MODELS[provider].map((m, i) => ({
      value: m,
      label: m,
      hint: i === 0 ? "recommended" : void 0
    }));
    llmModel = await p.select({
      message: "Model",
      options: modelOptions
    });
    if (p.isCancel(llmModel)) {
      p.cancel("Setup cancelled");
      process.exit(0);
    }
    const apiKey = await p.password({
      message: `${provider === "openai" ? "OpenAI" : provider === "anthropic" ? "Anthropic" : provider === "groq" ? "Groq" : "Google AI"} API Key`,
      validate: validateApiKey
    });
    if (p.isCancel(apiKey)) {
      p.cancel("Setup cancelled");
      process.exit(0);
    }
    llmApiKey = apiKey;
  }
  printSection("Wallet Configuration (Secure Storage)");
  console.log(chalk.gray("  Your wallet mnemonic will be stored in the OS keychain."));
  console.log(chalk.gray("  It will NEVER be saved in plaintext files."));
  console.log(chalk.gray("  Get testnet ALGO: https://bank.testnet.algorand.network/"));
  console.log();
  const mnemonic = await p.password({
    message: "Algorand Mnemonic (25 words)",
    validate: validateMnemonicInput
  });
  if (p.isCancel(mnemonic)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }
  const spinner = ora("Validating wallet...").start();
  let walletAddress;
  try {
    walletAddress = addressFromMnemonic(mnemonic);
    spinner.succeed(`Wallet: ${chalk.cyan(walletAddress.slice(0, 8))}...${chalk.cyan(walletAddress.slice(-4))}`);
  } catch (error) {
    spinner.fail("Invalid mnemonic");
    p.cancel("Setup failed");
    process.exit(1);
  }
  spinner.start("Storing wallet in OS keychain...");
  try {
    await saveWalletToKeychain(walletAddress, mnemonic);
    spinner.succeed(chalk.green("Wallet securely stored in OS keychain"));
  } catch (error) {
    spinner.fail("Failed to store wallet in keychain");
    console.log(chalk.red(`  Error: ${error.message}`));
    p.cancel("Setup failed");
    process.exit(1);
  }
  spinner.start("Checking wallet balance...");
  try {
    const balance = await getWalletBalance(walletAddress, "testnet");
    const formatted = formatBalance(balance);
    spinner.succeed(`Balance: ${chalk.green(formatted.algo)} ALGO, ${chalk.green(formatted.usdc)} USDC`);
    if (balance.algo < 1000000n) {
      console.log(chalk.yellow("\n  \u26A0 Low ALGO balance! Get testnet tokens:"));
      console.log(chalk.white("    https://bank.testnet.algorand.network/"));
    }
  } catch (error) {
    spinner.warn("Could not check balance");
  }
  printSection("Payment Preferences");
  const preferredToken = await p.select({
    message: "Preferred Payment Token",
    options: [
      { value: "ALGO", label: "ALGO", hint: "Algorand native token" },
      { value: "USDC", label: "USDC", hint: "USD Coin (stablecoin)" }
    ]
  });
  if (p.isCancel(preferredToken)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }
  printSection("Registry");
  const registryPath = await p.text({
    message: "Registry Path",
    initialValue: getDefaultRegistryPath(),
    placeholder: "~/.algope/registry.json"
  });
  if (p.isCancel(registryPath)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }
  spinner.start("Saving configuration...");
  try {
    const config = buildConfig({
      llmMode: mode,
      llmProvider: provider,
      llmModel,
      llmApiKey: llmApiKey || void 0,
      llmBaseURL: llmBaseURL || void 0,
      walletAddress,
      // Only address, mnemonic is in keychain
      preferredToken,
      registryPath,
      registryAppId: process.env.ALGOPE_REGISTRY_APP_ID || DEFAULT_REGISTRY_APP_ID,
      network: "testnet"
    });
    await saveConfig(config);
    spinner.succeed("Configuration saved!");
  } catch (error) {
    spinner.fail("Failed to save configuration");
    p.cancel("Setup failed");
    process.exit(1);
  }
  console.log();
  console.log(chalk.green.bold("\u2713 Agent configured with secure keychain storage!"));
  console.log();
  console.log(chalk.gray("  Configuration saved to:"));
  console.log(chalk.white(`    ${getConfigPath()}`));
  console.log();
  console.log(chalk.gray("  Wallet mnemonic stored in:"));
  console.log(chalk.white("    OS Keychain (encrypted, never in plaintext)"));
  console.log();
  console.log(chalk.gray("  Usage in your code:"));
  console.log(chalk.white('    import { AlgoPeAgent } from "algope-agent";'));
  console.log(chalk.white("    const agent = new AlgoPeAgent();"));
  console.log(chalk.white('    const result = await agent.run("Your task here");'));
  console.log();
  p.outro(chalk.green("Ready to use AI services with secure wallet storage!"));
}
async function runStatus() {
  printBanner();
  const config = await loadConfig();
  console.log(chalk.cyan.bold("\u25B8 Agent Status"));
  console.log(chalk.gray("\u2500".repeat(50)));
  console.log();
  if (!config) {
    console.log(chalk.yellow("  \u26A0 Agent not configured"));
    console.log(chalk.gray(`    Run ${chalk.cyan("algope-agent init")} to get started.`));
    console.log();
    return;
  }
  console.log(chalk.gray("  LLM:"));
  console.log(chalk.gray(`    Mode:     ${chalk.white(config.llm.mode || "api")}`));
  console.log(chalk.gray(`    Provider: ${chalk.white(config.llm.provider)}`));
  console.log(chalk.gray(`    Model:    ${chalk.white(config.llm.model)}`));
  if (config.llm.mode === "local") {
    console.log(chalk.gray(`    Base URL: ${chalk.white(config.llm.baseURL || "not set")}`));
  } else {
    console.log(chalk.gray(`    API Key:  ${chalk.green("\u2713 configured")}`));
  }
  console.log();
  console.log(chalk.gray("  Wallet:"));
  console.log(chalk.gray(`    Address:  ${chalk.cyan(config.wallet.address || "unknown")}`));
  console.log(chalk.gray(`    Network:  ${chalk.yellow(config.network || "testnet")}`));
  if (config.wallet.address) {
    const inKeychain = await hasMnemonic(config.wallet.address);
    if (inKeychain) {
      console.log(chalk.gray(`    Security: ${chalk.green("\u2713 Stored in OS Keychain (secure)")}`));
    } else {
      const isLegacy = await isLegacyConfig();
      if (isLegacy) {
        console.log(chalk.gray(`    Security: ${chalk.red("\u26A0 Plaintext storage (INSECURE)")}`));
        console.log(chalk.yellow(`              Run 'algope-agent migrate-keychain' to secure`));
      } else {
        console.log(chalk.gray(`    Security: ${chalk.yellow("\u26A0 Not found in keychain")}`));
      }
    }
  }
  if (config.wallet.address) {
    const spinner = ora("Checking balance...").start();
    try {
      const balance = await getWalletBalance(config.wallet.address, config.network || "testnet");
      const formatted = formatBalance(balance);
      spinner.stop();
      console.log(chalk.gray(`    ALGO:     ${chalk.green(formatted.algo)}`));
      console.log(chalk.gray(`    USDC:     ${chalk.green(formatted.usdc)}`));
    } catch {
      spinner.stop();
      console.log(chalk.gray(`    Balance:  ${chalk.yellow("(could not fetch)")}`));
    }
  }
  console.log();
  console.log(chalk.gray("  Payment:"));
  console.log(chalk.gray(`    Preferred: ${chalk.white(config.payment.preferredToken)}`));
  console.log();
  const registryClient = new RegistryClient(config.network ?? "testnet");
  console.log(chalk.gray("  Registry:"));
  console.log(chalk.gray(`    Contract: ${chalk.white(`App ID ${registryClient.getAppId()} (Algorand testnet)`)}`));
  console.log();
}
async function runServices() {
  printBanner();
  const config = await loadConfig();
  if (!config) {
    console.log(chalk.yellow("  \u26A0 Agent not configured"));
    console.log(chalk.gray(`    Run ${chalk.cyan("algope-agent init")} to get started.`));
    console.log();
    return;
  }
  console.log(chalk.cyan.bold("\u25B8 Available Services"));
  console.log(chalk.gray("\u2500".repeat(50)));
  console.log();
  const registryClient = new RegistryClient(config.network ?? "testnet");
  console.log(chalk.gray(`  On-chain registry: App ID ${registryClient.getAppId()} (Algorand testnet)`));
  console.log();
  console.log(chalk.gray("  To discover services, providers must register with: algope register"));
  console.log(chalk.gray("  Then use: algope-agent run --provider <service-name> --developer <address>"));
  console.log();
}
async function runMigrateKeychain() {
  printBanner();
  console.log(chalk.cyan.bold("\u25B8 Migrate to Secure Keychain Storage"));
  console.log(chalk.gray("\u2500".repeat(50)));
  console.log();
  const keychainAvailable = await isKeychainAvailable();
  if (!keychainAvailable) {
    console.log(chalk.red("  \u2717 OS Keychain is not available on this system."));
    console.log(chalk.gray("    Cannot migrate to secure storage."));
    process.exit(1);
  }
  console.log(chalk.green("  \u2713 OS Keychain available"));
  const isLegacy = await isLegacyConfig();
  if (!isLegacy) {
    const config = await loadConfig();
    if (config?.wallet.address) {
      const inKeychain = await hasMnemonic(config.wallet.address);
      if (inKeychain) {
        console.log(chalk.green("  \u2713 Wallet is already stored in OS Keychain"));
        console.log(chalk.gray("    No migration needed."));
        return;
      }
    }
    console.log(chalk.yellow("  \u26A0 No legacy configuration found to migrate"));
    console.log(chalk.gray("    Run 'algope-agent init' to set up your wallet."));
    return;
  }
  console.log(chalk.yellow("  \u26A0 Found legacy configuration with plaintext mnemonic"));
  console.log();
  const spinner = ora("Migrating to OS Keychain...").start();
  const result = await migrateToSecureStorage();
  if (result.success) {
    spinner.succeed(chalk.green("Successfully migrated to OS Keychain!"));
    console.log();
    console.log(chalk.gray("  Wallet Address:"));
    console.log(chalk.cyan(`    ${result.address}`));
    console.log();
    console.log(chalk.green("  \u2713 Mnemonic removed from config file"));
    console.log(chalk.green("  \u2713 Mnemonic stored securely in OS Keychain"));
    console.log();
    console.log(chalk.gray("  Your wallet is now protected by OS-level encryption."));
  } else {
    spinner.fail(chalk.red("Migration failed"));
    console.log(chalk.red(`  Error: ${result.error}`));
    process.exit(1);
  }
}
async function runSecurityInfo() {
  printBanner();
  console.log(chalk.cyan.bold("\u25B8 Security Information"));
  console.log(chalk.gray("\u2500".repeat(50)));
  console.log();
  const keychainAvailable = await isKeychainAvailable();
  console.log(chalk.gray("  OS Keychain:"));
  if (keychainAvailable) {
    console.log(chalk.green("    \u2713 Available and accessible"));
    const credInfo = await getCredentialInfo();
    console.log(chalk.gray(`    Stored wallets: ${credInfo.walletCount}`));
    if (credInfo.wallets.length > 0) {
      for (const wallet of credInfo.wallets) {
        console.log(chalk.gray(`      - ${wallet}`));
      }
    }
  } else {
    console.log(chalk.red("    \u2717 Not available"));
  }
  console.log();
  const config = await loadConfig();
  console.log(chalk.gray("  Configuration:"));
  if (config) {
    console.log(chalk.green("    \u2713 Config file exists"));
    console.log(chalk.gray(`    Address: ${config.wallet.address || "unknown"}`));
    const isLegacy = await isLegacyConfig();
    if (isLegacy) {
      console.log(chalk.red("    \u26A0 WARNING: Plaintext mnemonic in config file!"));
      console.log(chalk.yellow("      Run 'algope-agent migrate-keychain' to secure"));
    } else {
      console.log(chalk.green("    \u2713 No plaintext secrets in config"));
    }
  } else {
    console.log(chalk.yellow("    \u26A0 No config file found"));
  }
  console.log();
  console.log(chalk.cyan.bold("\u25B8 Security Recommendations"));
  console.log(chalk.gray("\u2500".repeat(50)));
  console.log();
  console.log(chalk.gray("  1. Use a dedicated 'hot wallet' with limited funds"));
  console.log(chalk.gray("  2. Keep only 10-50 ALGO for agent operations"));
  console.log(chalk.gray("  3. Never share your mnemonic with anyone"));
  console.log(chalk.gray("  4. The OS Keychain is encrypted with your login password"));
  console.log(chalk.gray("  5. Consider spending limits for production (coming soon)"));
  console.log();
}
async function runTask(task, options) {
  printBanner();
  const config = await loadConfig();
  if (!config) {
    console.log(chalk.yellow("  \u26A0 Agent not configured"));
    console.log(chalk.gray(`    Run ${chalk.cyan("algope-agent init")} to get started.`));
    console.log();
    return;
  }
  const mnemonic = await getWalletMnemonic(config.wallet.address);
  if (!mnemonic) {
    console.log(chalk.red("  \u2717 Wallet not found in OS Keychain"));
    const isLegacy = await isLegacyConfig();
    if (isLegacy) {
      console.log(chalk.yellow("    Found legacy config. Run 'algope-agent migrate-keychain' first."));
    } else {
      console.log(chalk.gray("    Run 'algope-agent init' to set up your wallet."));
    }
    console.log();
    return;
  }
  console.log(chalk.cyan.bold("\u25B8 Running Task"));
  console.log(chalk.gray("\u2500".repeat(50)));
  console.log();
  console.log(chalk.gray(`  Task: ${chalk.white(task)}`));
  if (options.provider) {
    console.log(chalk.gray(`  Provider: ${chalk.white(options.provider)}`));
  }
  console.log(chalk.gray(`  Wallet: ${chalk.green("\u2713 Loaded from OS Keychain")}`));
  console.log();
  const spinner = ora("Thinking...").start();
  const agent = new AlgoPeAgent({
    config,
    verbose: options.verbose
  });
  try {
    const result = await agent.run(task, {
      provider: options.provider,
      onStep: (step) => {
        if (step.toolName) {
          spinner.text = `Calling ${step.toolName}...`;
        } else {
          spinner.text = "Thinking...";
        }
      },
      onPayment: (receipt) => {
        console.log(
          chalk.green(`  \u{1F4B0} Paid ${receipt.amount} ${receipt.token} to ${receipt.service}`)
        );
      }
    });
    spinner.stop();
    if (result.success) {
      console.log(chalk.green.bold("\u2713 Task completed"));
      console.log();
      console.log(chalk.white(result.text));
      console.log();
      if (result.payments.transactionCount > 0) {
        console.log(chalk.gray("  Payments:"));
        console.log(chalk.gray(`    Transactions: ${result.payments.transactionCount}`));
        console.log(chalk.gray(`    Total ALGO:   ${result.payments.totalSpent.ALGO}`));
        console.log(chalk.gray(`    Total USDC:   ${result.payments.totalSpent.USDC}`));
      }
      console.log(chalk.gray(`  Duration: ${result.duration}ms`));
    } else {
      console.log(chalk.red.bold("\u2717 Task failed"));
      console.log(chalk.red(`  ${result.error}`));
    }
  } catch (error) {
    spinner.fail("Task failed");
    console.log(chalk.red(`  ${error.message}`));
  }
  console.log();
}
program.name("algope-agent").description("AlgoPe Agent \u2014 Pre-built AI agent with x402 payments on Algorand (Secure Keychain Storage)").version(VERSION);
program.command("init").description("Configure the AlgoPe agent (stores wallet in OS keychain)").action(runInit);
program.command("status").description("Show agent configuration and security status").action(runStatus);
program.command("services").description("List available services in the registry").action(runServices);
program.command("migrate-keychain").description("Migrate legacy plaintext wallet to secure OS keychain storage").action(runMigrateKeychain);
program.command("security").description("Show security information and recommendations").action(runSecurityInfo);
program.command("run <task>").description("Run a task with the agent").option("-p, --provider <name>", "Specify a service provider to use").option("-v, --verbose", "Enable verbose output").action(runTask);
program.parse();
//# sourceMappingURL=cli.js.map