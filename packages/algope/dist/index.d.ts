import { PaymentRequirements, SupportedResponse, PaymentPayload, VerifyResponse, SettleResponse } from '@x402-avm/core/types';
import { Express } from 'express';
import { RoutesConfig } from '@x402-avm/core/server';
export { RoutesConfig } from '@x402-avm/core/server';
import algosdk from 'algosdk';

/**
 * AlgoPe Provider Types
 * Algorand-native types for x402 payment gateway
 */

declare const ALGORAND_TESTNET_CAIP2 = "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=";
declare const ALGORAND_MAINNET_CAIP2 = "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=";
declare const ALGORAND_WILDCARD_CAIP2 = "algorand:*";
declare const USDC_TESTNET_ASA_ID = 10458941;
declare const USDC_MAINNET_ASA_ID = 31566704;
declare const USDC_DECIMALS = 6;
declare const ALGO_DECIMALS = 6;
declare const ALGOD_TESTNET_URL = "https://testnet-api.algonode.cloud";
declare const ALGOD_MAINNET_URL = "https://mainnet-api.algonode.cloud";
/**
 * GoPlausible's hosted x402 facilitator — the reference facilitator for Algorand
 * x402 (also fronts Base and Solana). Verifies and settles payments, sponsors
 * network fees via its advertised `feePayer`, and catalogs paid resources for
 * Bazaar discovery.
 */
declare const GOPLAUSIBLE_FACILITATOR_URL = "https://facilitator.goplausible.xyz";
type PaymentToken = "ALGO" | "USDC";
interface TokenInfo {
    symbol: PaymentToken;
    decimals: number;
    asaId?: number;
    name: string;
}
declare const TOKENS: Record<PaymentToken, TokenInfo>;
interface AlgoPeConfig {
    serviceName: string;
    serviceDescription: string;
    tags: string[];
    targetUrl: string;
    pricePerRequest: string;
    paymentToken: PaymentToken;
    walletAddress: string;
    mnemonic?: string;
    proxyPort: number;
    network: "testnet" | "mainnet";
    registryAppId?: string;
    facilitatorMode?: "auto" | "goplausible" | "local" | "self";
    /** Override the facilitator base URL (self-hosted or staging). */
    facilitatorUrl?: string;
    /** Bearer token, for facilitators that gate /verify and /settle. */
    facilitatorApiKey?: string;
    logLevel?: "verbose" | "normal" | "quiet";
    adminKey?: string;
    rateLimit?: number;
}
interface ServiceRegistration {
    id: string;
    name: string;
    description: string;
    tags: string[];
    endpoint: string;
    pricePerRequest: string;
    paymentToken: PaymentToken;
    walletAddress: string;
    network: "testnet" | "mainnet";
    createdAt: string;
    updatedAt: string;
}
interface Registry {
    version: string;
    services: ServiceRegistration[];
}
interface RouteConfig {
    path: string;
    pricePerRequest: string;
    paymentToken: PaymentToken;
    description?: string;
}
interface ResolvedRoute {
    path: string;
    requirements: PaymentRequirements;
}
interface RequestStats {
    totalRequests: number;
    paidRequests: number;
    failedPayments: number;
    totalRevenue: bigint;
    revenueByToken: Record<PaymentToken, bigint>;
    requestsPerMinute: number[];
    lastHourRequests: number;
}
interface PaymentEvent {
    timestamp: Date;
    path: string;
    amount: string;
    token: PaymentToken;
    payer: string;
    txId?: string;
    success: boolean;
    error?: string;
}
interface ServerState {
    isRunning: boolean;
    startedAt?: Date;
    config: AlgoPeConfig;
    stats: RequestStats;
    recentPayments: PaymentEvent[];
}
interface InitAnswers {
    targetUrl: string;
    serviceName: string;
    serviceDescription: string;
    pricePerRequest: string;
    paymentToken: PaymentToken;
    tags: string;
    walletAddress: string;
    mnemonic: string;
    proxyPort: number;
}
type LogLevel = "verbose" | "normal" | "quiet";
interface Logger {
    verbose: (message: string, ...args: unknown[]) => void;
    info: (message: string, ...args: unknown[]) => void;
    success: (message: string, ...args: unknown[]) => void;
    warn: (message: string, ...args: unknown[]) => void;
    error: (message: string, ...args: unknown[]) => void;
}

/**
 * ALGO Native Facilitator
 *
 * Verifies and settles x402 payments using native ALGO payment transactions.
 * Broadcasts signed transactions to Algorand and returns real transaction IDs.
 *
 * No mnemonic required - only verifies and broadcasts already-signed transactions.
 */

/**
 * FacilitatorClient interface that x402ResourceServer expects
 */
interface FacilitatorClient {
    getSupported(): Promise<SupportedResponse>;
    verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse>;
    settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse>;
}

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

type FacilitatorMode = "goplausible" | "local" | "self" | "auto";
interface ResolvedFacilitator {
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
interface ResolveFacilitatorOptions {
    config: AlgoPeConfig;
    /** Mnemonic for `local` mode (from `algope start --facilitator`). */
    facilitatorMnemonic?: string;
}
/**
 * Resolves the facilitator for a proxy run. Performs a network preflight when
 * remote mode is in play, and never throws — it degrades to local settlement.
 */
declare function resolveFacilitator(options: ResolveFacilitatorOptions): Promise<ResolvedFacilitator>;

/**
 * Analytics Module
 * Tracks payment events and request statistics
 */

declare class Analytics {
    private stats;
    private recentPayments;
    private minuteRequests;
    private currentMinute;
    constructor();
    /**
     * Records a request (paid or unpaid)
     */
    recordRequest(): void;
    /**
     * Records a successful payment
     */
    recordPayment(event: PaymentEvent): void;
    /**
     * Updates per-minute request tracking
     */
    private updateMinuteStats;
    /**
     * Gets current statistics
     */
    getStats(): RequestStats;
    /**
     * Gets recent payment events
     */
    getRecentPayments(): PaymentEvent[];
    /**
     * Gets formatted revenue summary
     */
    getRevenueSummary(): Record<PaymentToken, string>;
    /**
     * Resets all statistics
     */
    reset(): void;
}
declare const analytics: Analytics;

/**
 * AlgoPe Proxy Server
 * x402 payment gateway for Algorand using the GoPlausible x402-avm libraries
 *
 * Supports two modes:
 * 1. Simple verifier (default) - verifies payments by checking Algorand blockchain
 * 2. Local facilitator (when mnemonic is provided) - runs in-process with signing
 */

interface ProxyServerOptions {
    config: AlgoPeConfig;
    additionalRoutes?: RouteConfig[];
    onPayment?: (event: PaymentEvent) => void;
    /** Optional mnemonic for local facilitator mode (enables gasless transactions) */
    facilitatorMnemonic?: string;
}
/**
 * Creates and configures the x402 proxy server.
 *
 * Async because facilitator selection preflights the remote GoPlausible
 * facilitator (see `facilitator/resolve.ts`) before the gateway starts serving.
 */
declare function createProxyServer(options: ProxyServerOptions): Promise<{
    app: Express;
    facilitator: ResolvedFacilitator;
}>;
/**
 * Starts the proxy server
 */
declare function startProxyServer(options: ProxyServerOptions): Promise<{
    app: Express;
    server: ReturnType<Express["listen"]>;
    facilitator: ResolvedFacilitator;
}>;

/**
 * Route Configuration
 * Defines x402 payment requirements for protected routes
 */

/**
 * Internal type for route display
 */
interface RouteDisplayInfo {
    path: string;
    price: string;
    token: string;
    decimals: number;
}
/**
 * Creates a routes map for the x402 middleware
 */
declare function createRoutesConfig(config: AlgoPeConfig, additionalRoutes?: RouteConfig[]): RoutesConfig;
/**
 * Formats routes for display in the CLI
 */
declare function formatRoutesForDisplay(routes: RoutesConfig): RouteDisplayInfo[];

/**
 * Algorand client helpers
 *
 * Node/account utilities shared across the facilitator implementations.
 * The facilitator clients themselves live in `goplausible.ts` (remote),
 * `local-facilitator-client.ts`, `algo-facilitator.ts`, and `simple-verifier.ts`;
 * `resolve.ts` picks between them.
 */

/**
 * Creates an Algod client for interacting with the Algorand network
 */
declare function createAlgodClient(network: "testnet" | "mainnet"): algosdk.Algodv2;
/**
 * Validates an Algorand wallet address (58-char base32)
 */
declare function isValidAlgorandAddress(address: string): boolean;
/**
 * Validates a 25-word Algorand mnemonic
 */
declare function isValidMnemonic(mnemonic: string): boolean;
/**
 * Derives wallet address from mnemonic
 */
declare function addressFromMnemonic(mnemonic: string): string;
/**
 * Gets account info from the Algorand network
 */
declare function getAccountInfo(algod: algosdk.Algodv2, address: string): Promise<{
    balance: bigint;
    minBalance: bigint;
    assets: Array<{
        assetId: bigint;
        amount: bigint;
    }>;
}>;
/**
 * Formats microAlgos to ALGO with proper decimals
 */
declare function formatAlgo(microAlgos: bigint, decimals?: number): string;
/**
 * Parses a human-readable amount to microunits
 */
declare function parseAmount(amount: string, decimals?: number): bigint;

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

interface GoPlausibleFacilitatorOptions {
    /** Network the proxy is serving. Determines which CAIP-2 kind we require. */
    network: "testnet" | "mainnet";
    /** Override the facilitator base URL (self-hosted or staging). */
    url?: string;
    /** Optional bearer token, for facilitators that gate /verify and /settle. */
    apiKey?: string;
    /** Preflight timeout in ms. */
    timeoutMs?: number;
}
interface FacilitatorProbeResult {
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
declare function caip2For(network: string): string;
/**
 * The x402 scheme a given AlgoPe payment token settles under.
 * USDC (and any ASA) uses upstream `exact`; native ALGO uses AlgoPe's `algo-exact`.
 */
declare function schemeForToken(token: "ALGO" | "USDC"): string;
/**
 * Builds a facilitator client bound to GoPlausible's hosted x402 facilitator.
 *
 * This does no network I/O — call `probeFacilitator()` first if you want to know
 * whether the facilitator can actually settle your scheme before committing to it.
 */
declare function createGoPlausibleFacilitator(options: GoPlausibleFacilitatorOptions): FacilitatorClient;
/**
 * Preflight: is the facilitator up, and can it settle `requiredScheme` on our network?
 *
 * Never throws — an unreachable facilitator returns `usable: false` with a reason so
 * the proxy can fall back to local settlement instead of refusing to boot.
 */
declare function probeFacilitator(options: GoPlausibleFacilitatorOptions & {
    requiredScheme: string;
}): Promise<FacilitatorProbeResult>;

/**
 * AlgoPe On-Chain Registry Client
 *
 * Reads from and writes to the deployed AlgoPeRegistry smart contract on Algorand.
 * Uses raw algosdk v3 — no algokit-utils required.
 *
 * App ID priority:
 *   1. ALGOPE_REGISTRY_APP_ID environment variable
 *   2. registryAppId field in ~/.algope/config.json
 *   3. Default fallback (769455464)
 */

interface RegistrationResult {
    txnHash: string;
    appId: bigint;
    appAddress: string;
}
interface OnChainService {
    name: string;
    description: string;
    tags: string[];
    endpoint: string;
    pricePerRequest: string;
    paymentToken: PaymentToken;
    walletAddress: string;
    network: "testnet" | "mainnet";
    developer: string;
    createdAt: number;
    updatedAt: number;
}
declare class AlgoPeRegistryClient {
    private algod;
    readonly appId: bigint;
    readonly appAddress: string;
    constructor(network?: "testnet" | "mainnet");
    /**
     * Registers (or updates) a service on-chain.
     *
     * Step 1: Fund the app address with enough ALGO to cover box MBR (standalone tx).
     * Step 2: Atomic group:
     *   [0] PaymentTxn  → ADMIN (1 ALGO registration fee) — this is `payTx`
     *   [1] AppCallTxn  → register() or update()
     */
    registerService(params: {
        mnemonic: string;
        name: string;
        description: string;
        tags: string[];
        endpoint: string;
        pricePerRequest: string;
        paymentToken: PaymentToken;
        walletAddress: string;
        network: "testnet" | "mainnet";
        isUpdate?: boolean;
    }): Promise<RegistrationResult>;
    /**
     * Fetches a service from on-chain using algod simulate (read-only, no fee).
     * Returns null if the service does not exist.
     */
    getService(developerAddress: string, serviceName: string): Promise<OnChainService | null>;
    /** Returns true if a service exists for the given developer+name. */
    hasService(developerAddress: string, serviceName: string): Promise<boolean>;
    /** Contract info for display. */
    getContractInfo(): {
        appId: bigint;
        appAddress: string;
    };
}
declare function onChainToServiceRegistration(svc: OnChainService): ServiceRegistration;

/**
 * AlgoPe Logger
 * Beautiful, structured logging with colors and icons
 */

declare function setLogLevel(level: LogLevel): void;
declare function getLogLevel(): LogLevel;
declare const logger: Logger;
declare const logPayment: (amount: string, token: string, payer: string, path: string) => void;
declare const logRequest: (method: string, path: string, status: number, duration: number) => void;
declare const logServerStart: (port: number, serviceName: string) => void;

export { ALGOD_MAINNET_URL, ALGOD_TESTNET_URL, ALGORAND_MAINNET_CAIP2, ALGORAND_TESTNET_CAIP2, ALGORAND_WILDCARD_CAIP2, ALGO_DECIMALS, type AlgoPeConfig, AlgoPeRegistryClient, Analytics, type FacilitatorMode, type FacilitatorProbeResult, GOPLAUSIBLE_FACILITATOR_URL, type GoPlausibleFacilitatorOptions, type InitAnswers, type LogLevel, type Logger, type OnChainService, type PaymentEvent, type PaymentToken, type RegistrationResult, type Registry, type RequestStats, type ResolveFacilitatorOptions, type ResolvedFacilitator, type ResolvedRoute, type RouteConfig, type ServerState, type ServiceRegistration, TOKENS, type TokenInfo, USDC_DECIMALS, USDC_MAINNET_ASA_ID, USDC_TESTNET_ASA_ID, addressFromMnemonic, analytics, caip2For, createAlgodClient, createGoPlausibleFacilitator, createProxyServer, createRoutesConfig, formatAlgo, formatRoutesForDisplay, getAccountInfo, getLogLevel, isValidAlgorandAddress, isValidMnemonic, logPayment, logRequest, logServerStart, logger, onChainToServiceRegistration, parseAmount, probeFacilitator, resolveFacilitator, schemeForToken, setLogLevel, startProxyServer };
