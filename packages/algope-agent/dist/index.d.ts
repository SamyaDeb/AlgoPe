import algosdk from 'algosdk';
import { ClientAvmSigner } from '@x402-avm/avm';
import * as ai from 'ai';

/**
 * AlgoPe Agent SDK Types
 * Types for the consumer-side AI agent with x402 payment capabilities
 */
type LLMMode = "api" | "local";
type LLMProvider = "openai" | "anthropic" | "gemini" | "groq";
interface LLMConfig {
    mode?: LLMMode;
    provider: LLMProvider;
    model: string;
    apiKey?: string;
    baseURL?: string;
}
type PaymentToken = "ALGO" | "USDC";
interface WalletConfig {
    address: string;
    useKeychain?: boolean;
}
/**
 * Legacy wallet config for migration purposes
 * @deprecated Use WalletConfig with keychain storage instead
 */
interface LegacyWalletConfig {
    mnemonic: string;
    address?: string;
}
interface PaymentConfig {
    preferredToken: PaymentToken;
    maxPricePerRequest?: string;
}
interface AgentConfig {
    llm: LLMConfig;
    wallet: WalletConfig;
    payment: PaymentConfig;
    registryPath?: string;
    network?: "testnet" | "mainnet";
    registryAppId?: string;
}
interface ServiceInfo {
    id: string;
    name: string;
    description: string;
    tags: string[];
    endpoint: string;
    pricePerRequest: string;
    paymentToken: PaymentToken;
    walletAddress: string;
    network: "testnet" | "mainnet";
    createdAt?: string;
    updatedAt?: string;
}
interface Registry {
    version: string;
    services: ServiceInfo[];
}
interface PaymentReceipt {
    txId?: string;
    amount: string;
    token: PaymentToken;
    recipient: string;
    timestamp: Date;
    service: string;
    path: string;
}
interface PaymentSummary {
    totalSpent: Record<PaymentToken, string>;
    transactionCount: number;
    receipts: PaymentReceipt[];
}
interface RunOptions {
    provider?: string;
    maxSteps?: number;
    verbose?: boolean;
    onStep?: (step: StepInfo) => void;
    onPayment?: (receipt: PaymentReceipt) => void;
}
interface StepInfo {
    stepNumber: number;
    toolName?: string;
    toolArgs?: Record<string, unknown>;
    toolResult?: unknown;
    text?: string;
    thinking?: string;
}
interface TaskResult {
    text: string;
    success: boolean;
    steps: StepInfo[];
    payments: PaymentSummary;
    error?: string;
    duration: number;
}
interface ToolCallInfo {
    name: string;
    args: Record<string, unknown>;
}
interface ToolResultInfo {
    name: string;
    result: unknown;
}
interface HttpRequestOptions {
    method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
    headers?: Record<string, string>;
    body?: unknown;
    timeout?: number;
}
interface HttpResponse<T = unknown> {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    data: T;
    paid?: boolean;
    paymentReceipt?: PaymentReceipt;
}
interface PaymentRequirementsHeader {
    scheme: string;
    network: string;
    maxAmountRequired: string;
    resource: string;
    description: string;
    payTo: string;
    maxTimeoutSeconds: number;
    extra?: Record<string, unknown>;
}
declare const ALGORAND_TESTNET_CAIP2 = "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=";
declare const ALGORAND_MAINNET_CAIP2 = "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=";
declare const USDC_TESTNET_ASA_ID = 10458941;
declare const USDC_MAINNET_ASA_ID = 31566704;
declare const ALGOD_TESTNET_URL = "https://testnet-api.algonode.cloud";
declare const ALGOD_MAINNET_URL = "https://mainnet-api.algonode.cloud";
declare const INDEXER_TESTNET_URL = "https://testnet-idx.algonode.cloud";
declare const INDEXER_MAINNET_URL = "https://mainnet-idx.algonode.cloud";
declare const DEFAULT_REGISTRY_PATH = "~/.algope/registry.json";
declare const CONFIG_PATH = "~/.algope/agent.json";

/**
 * AlgoPe Agent
 * Pre-built AI agent with x402 payment capabilities
 *
 * SECURITY: Wallet mnemonics are retrieved from OS keychain at runtime,
 * never stored in plaintext files.
 */

interface AlgoPeAgentOptions {
    config?: AgentConfig;
    verbose?: boolean;
}
/**
 * AlgoPe Agent - Pre-built AI agent that can discover and call paid services
 */
declare class AlgoPeAgent {
    private config;
    private registryClient;
    private paymentClient;
    private verbose;
    private initialized;
    constructor(options?: AlgoPeAgentOptions);
    /**
     * Initializes the agent (loads config if not provided)
     * Retrieves wallet mnemonic securely from OS keychain
     */
    private ensureInitialized;
    /**
     * Creates the LLM model instance
     */
    private createModel;
    /**
     * Creates the tools for the agent
     */
    private createTools;
    private createFallbackTools;
    /**
     * Runs a task with the agent
     */
    run(task: string, options?: RunOptions): Promise<TaskResult>;
    /**
     * Gets the wallet address
     */
    getWalletAddress(): Promise<string>;
    /**
     * Lists available services
     */
    listServices(): Promise<Array<{
        name: string;
        description: string;
        price: string;
    }>>;
    /**
     * Gets the current configuration
     */
    getConfig(): AgentConfig | null;
    /**
     * Creates a AlgoPe agent from saved configuration
     * Convenience factory method for SDK users
     */
    static fromConfig(): Promise<AlgoPeAgent>;
}
/**
 * Creates a new AlgoPe agent instance
 */
declare function createAgent(options?: AlgoPeAgentOptions): AlgoPeAgent;

/**
 * Configuration Manager
 * Handles loading and saving agent configuration from ~/.algope/agent.json
 *
 * SECURITY: Wallet mnemonics are stored in OS keychain, NOT in the config file.
 * The config file only stores the wallet address and a flag indicating keychain usage.
 */

/**
 * Loads the agent configuration from disk
 * Returns null if no configuration exists
 *
 * NOTE: This function does NOT load the mnemonic from keychain.
 * Use getWalletMnemonic() to retrieve the mnemonic when needed.
 */
declare function loadConfig(): Promise<AgentConfig | null>;
/**
 * Checks if the current config is using legacy plaintext storage
 */
declare function isLegacyConfig(): Promise<boolean>;
/**
 * Saves the agent configuration to disk
 * NOTE: This does NOT save the mnemonic to the config file.
 * Use saveWalletToKeychain() to store the mnemonic securely.
 */
declare function saveConfig(config: AgentConfig): Promise<void>;
/**
 * Checks if configuration exists
 */
declare function configExists(): Promise<boolean>;
/**
 * Returns the config file path
 */
declare function getConfigPath(): string;
/**
 * Returns the default registry path
 */
declare function getDefaultRegistryPath(): string;
/**
 * Saves wallet mnemonic to OS keychain
 * This is the secure way to store the mnemonic
 */
declare function saveWalletToKeychain(walletAddress: string, mnemonic: string): Promise<void>;
/**
 * Gets wallet mnemonic from OS keychain
 * Returns null if not found or keychain unavailable
 */
declare function getWalletMnemonic(walletAddress: string): Promise<string | null>;
/**
 * Checks if wallet mnemonic is available (either in keychain or legacy config)
 */
declare function isWalletAvailable(walletAddress: string): Promise<boolean>;
/**
 * Migrates legacy plaintext config to secure keychain storage
 */
declare function migrateToSecureStorage(): Promise<{
    success: boolean;
    address?: string;
    error?: string;
}>;
/**
 * Derives wallet address from mnemonic
 */
declare function addressFromMnemonic(mnemonic: string): string;
/**
 * Validates a 25-word Algorand mnemonic
 */
declare function isValidMnemonic(mnemonic: string): boolean;
/**
 * Validates an Algorand wallet address
 */
declare function isValidAddress(address: string): boolean;
interface ConfigBuilder {
    llmMode?: LLMMode;
    llmProvider: LLMProvider;
    llmModel: string;
    llmApiKey?: string;
    llmBaseURL?: string;
    walletAddress: string;
    preferredToken: PaymentToken;
    registryPath?: string;
    registryAppId?: string;
    network?: "testnet" | "mainnet";
}
/**
 * Creates an AgentConfig from builder parameters
 * NOTE: This does NOT include the mnemonic - it should be stored in keychain separately
 */
declare function buildConfig(builder: ConfigBuilder): AgentConfig;
declare const DEFAULT_MODELS: Record<LLMProvider, string[]>;
declare function getDefaultModel(provider: LLMProvider): string;

/**
 * Secure Credential Storage using OS Keychain
 *
 * This module provides secure storage for the agent wallet mnemonic using
 * the operating system's native credential manager:
 * - macOS: Keychain Access
 * - Linux: Secret Service API (GNOME Keyring, KWallet)
 * - Windows: Credential Manager
 *
 * The mnemonic is never stored in plaintext on disk.
 * It's encrypted by the OS and tied to the user's login credentials.
 */
/**
 * Stores a wallet mnemonic securely in the OS keychain
 *
 * @param walletAddress - The Algorand wallet address (used as unique identifier)
 * @param mnemonic - The 25-word Algorand mnemonic to store
 * @throws Error if keychain access is denied or unavailable
 */
declare function saveMnemonic(walletAddress: string, mnemonic: string): Promise<void>;
/**
 * Retrieves a wallet mnemonic from the OS keychain
 *
 * @param walletAddress - The Algorand wallet address
 * @returns The mnemonic if found, null otherwise
 * @throws Error if keychain access is denied
 */
declare function getMnemonic(walletAddress: string): Promise<string | null>;
/**
 * Removes a wallet mnemonic from the OS keychain
 *
 * @param walletAddress - The Algorand wallet address
 * @returns true if the entry was deleted, false if it didn't exist
 */
declare function deleteMnemonic(walletAddress: string): Promise<boolean>;
/**
 * Checks if a wallet mnemonic exists in the keychain
 *
 * @param walletAddress - The Algorand wallet address
 * @returns true if the mnemonic is stored
 */
declare function hasMnemonic(walletAddress: string): Promise<boolean>;
/**
 * Lists all wallet addresses that have stored mnemonics
 *
 * @returns Array of wallet addresses with stored credentials
 */
declare function listStoredWallets(): Promise<string[]>;
/**
 * Removes all AlgoPe agent credentials from the keychain
 * Use with caution - this will delete all stored mnemonics!
 *
 * @returns Number of entries deleted
 */
declare function clearAllCredentials(): Promise<number>;
/**
 * Tests if the keychain is accessible
 * Useful for checking if the system supports keychain storage
 *
 * @returns true if keychain is accessible
 */
declare function isKeychainAvailable(): Promise<boolean>;
/**
 * Migrates a plaintext mnemonic to the keychain
 *
 * @param walletAddress - The wallet address
 * @param plaintextMnemonic - The mnemonic to migrate
 * @returns true if migration was successful
 */
declare function migrateToKeychain(walletAddress: string, plaintextMnemonic: string): Promise<boolean>;
/**
 * Gets information about stored credentials (without revealing secrets)
 * Useful for debugging keychain issues
 */
declare function getCredentialInfo(): Promise<{
    available: boolean;
    walletCount: number;
    wallets: string[];
}>;

/**
 * Wallet Module
 * Handles Algorand wallet operations and creates signers for x402 payments
 *
 * SECURITY: Wallet mnemonics are retrieved from OS keychain, never stored in files.
 */

interface WalletInstance {
    address: string;
    secretKey: Uint8Array;
    signer: ClientAvmSigner;
}
/**
 * Creates a wallet instance from a mnemonic
 * The wallet can sign x402 payment transactions
 */
declare function createWalletFromMnemonic(mnemonic: string): WalletInstance;
/**
 * Creates a wallet instance from config by retrieving mnemonic from OS keychain
 * This is the secure way to create a wallet - mnemonic is never stored in files
 *
 * @throws Error if mnemonic is not found in keychain
 */
declare function createWalletFromConfig(config: WalletConfig): Promise<WalletInstance>;
/**
 * Creates a wallet instance from address by retrieving mnemonic from OS keychain
 * Convenience function when you only have the address
 *
 * @throws Error if mnemonic is not found in keychain
 */
declare function createWalletFromAddress(address: string): Promise<WalletInstance>;
/**
 * Creates an Algod client for network operations
 */
declare function createAlgodClient(network: "testnet" | "mainnet"): algosdk.Algodv2;
interface WalletBalance {
    algo: bigint;
    usdc: bigint;
    minBalance: bigint;
    optedIntoUsdc: boolean;
}
/**
 * Gets the wallet balance from the Algorand network
 */
declare function getWalletBalance(address: string, network: "testnet" | "mainnet"): Promise<WalletBalance>;
/**
 * Checks if wallet has sufficient balance for a payment
 */
declare function hasSufficientBalance(balance: WalletBalance, amount: bigint, token: PaymentToken): boolean;
/**
 * Formats microunits to human-readable amount
 */
declare function formatAmount(microunits: bigint, decimals?: number): string;
/**
 * Parses human-readable amount to microunits
 */
declare function parseAmount(amount: string, decimals?: number): bigint;
/**
 * Formats wallet balance for display
 */
declare function formatBalance(balance: WalletBalance): {
    algo: string;
    usdc: string;
    available: string;
};

/**
 * AlgoPe Agent Registry Client
 * Reads service registrations from the on-chain AlgoPeRegistry contract on Algorand.
 *
 * App ID priority:
 *   1. ALGOPE_REGISTRY_APP_ID environment variable
 *   2. registryAppId field in ~/.algope/agent.json
 *   3. Default fallback (757397216)
 */

interface SearchOptions {
    name?: string;
    tags?: string[];
    paymentToken?: PaymentToken;
    network?: "testnet" | "mainnet";
    maxPrice?: string;
}
declare class RegistryClient {
    private algod;
    private indexer;
    private appId;
    private network;
    constructor(network?: "testnet" | "mainnet");
    /**
     * Fetches a specific service by developer address and name.
     */
    findService(developerAddress: string, name: string): Promise<ServiceInfo | undefined>;
    /**
     * Searches for a service by name across known developers.
     * Since box scanning is not directly supported without indexer,
     * this accepts an optional developer hint or searches the config.
     */
    findByName(name: string, developerAddress?: string): Promise<ServiceInfo | undefined>;
    /**
     * Returns service info for a given developer + name.
     * Equivalent to getService on-chain.
     */
    getService(developerAddress: string, name: string): Promise<ServiceInfo | undefined>;
    /**
     * Returns all services for a developer (given a list of known service names).
     * Without an indexer, we need either a known list or a single name.
     */
    listForDeveloper(developerAddress: string, serviceNames: string[]): Promise<ServiceInfo[]>;
    /**
     * Search services (requires a list of developer:name pairs to query).
     */
    search(knownServices: Array<{
        developer: string;
        name: string;
    }>, options?: SearchOptions): Promise<ServiceInfo[]>;
    /**
     * Lists ALL services registered on-chain using Algorand Indexer.
     * This enumerates all boxes in the registry contract and fetches their details.
     *
     * @returns Array of all available services
     * @throws Error if indexer is unavailable
     */
    listAllServices(): Promise<ServiceInfo[]>;
    /** App ID of the registry contract. */
    getAppId(): bigint;
}
/**
 * Loads the on-chain registry for a specific developer address and list of service names.
 * Falls back to empty registry if nothing found.
 */
declare function loadRegistry(developerAddress?: string, serviceNames?: string[], network?: "testnet" | "mainnet"): Promise<Registry>;
declare function searchServices(registry: Registry, options?: SearchOptions): ServiceInfo[];
declare function findServiceByName(registry: Registry, name: string): ServiceInfo | undefined;
declare function getAllTags(registry: Registry): string[];
declare function findServiceById(registry: Registry, id: string): ServiceInfo | undefined;
declare function registryExists(developerAddress?: string, network?: "testnet" | "mainnet"): Promise<boolean>;
declare function getServiceStats(registry: Registry): {
    total: number;
    byToken: Record<PaymentToken, number>;
    byNetwork: Record<string, number>;
};

/**
 * Payment Client
 * Handles x402 payment flow: detect 402, sign payment, retry request
 */

interface PaymentClientOptions {
    mnemonic: string;
    network?: "testnet" | "mainnet";
    onPayment?: (receipt: PaymentReceipt) => void;
}
/**
 * Client for making x402 payments on Algorand
 */
declare class PaymentClient {
    private wallet;
    private coreClient;
    private httpClient;
    private network;
    private onPayment?;
    private receipts;
    private totalSpent;
    constructor(options: PaymentClientOptions);
    /**
     * Gets the wallet address
     */
    getAddress(): string;
    /**
     * Makes an HTTP request with automatic x402 payment handling
     */
    fetch<T = unknown>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>>;
    /**
     * Makes a request to a known paid service
     */
    callService<T = unknown>(service: ServiceInfo, path?: string, options?: HttpRequestOptions): Promise<HttpResponse<T>>;
    /**
     * Records a payment
     */
    /**
     * Reads the settlement result the resource server attaches to the paid
     * response. Never throws: a receipt without a txid is still worth recording.
     */
    private readSettlement;
    private recordPayment;
    /**
     * Gets all payment receipts
     */
    getReceipts(): PaymentReceipt[];
    /**
     * Gets total spent by token
     */
    getTotalSpent(): Record<PaymentToken, string>;
    /**
     * Gets transaction count
     */
    getTransactionCount(): number;
    /**
     * Resets payment tracking
     */
    reset(): void;
    /**
     * Parses response body
     */
    private parseResponse;
    /**
     * Converts Headers to plain object
     */
    private headersToObject;
}
/**
 * Creates a payment client
 */
declare function createPaymentClient(mnemonic: string, options?: Partial<PaymentClientOptions>): PaymentClient;

interface DiscoverServiceToolOptions {
    registryClient: RegistryClient;
}
/**
 * Creates a tool for discovering services in the registry
 */
declare function createDiscoverServiceTool(options: DiscoverServiceToolOptions): ai.Tool<{
    paymentToken?: "ALGO" | "USDC" | undefined;
    query?: string | undefined;
    tags?: string[] | undefined;
    maxPrice?: string | undefined;
}, {
    found: boolean;
    message: string;
    services: {
        name: string;
        description: string;
        price: string;
        tags: string[];
        endpoint: string;
    }[];
}>;
/**
 * Format service info for display
 */
declare function formatServiceForDisplay(service: ServiceInfo): string;

interface CallPaidApiToolOptions {
    paymentClient: PaymentClient;
    registryClient: RegistryClient;
    providerHint?: string;
}
/**
 * Creates a tool for calling paid APIs with automatic x402 payment
 */
declare function createCallPaidApiTool(options: CallPaidApiToolOptions): ai.Tool<{
    method: "GET" | "POST" | "PUT" | "DELETE";
    path: string;
    serviceName: string;
    body?: Record<string, unknown> | undefined;
}, {
    success: boolean;
    data: unknown;
    paid: boolean;
    cached: boolean;
    note: string;
    error?: undefined;
    suggestion?: undefined;
    status?: undefined;
    payment?: undefined;
    serviceName?: undefined;
    endpoint?: undefined;
} | {
    success: boolean;
    error: string;
    suggestion: string;
    data?: undefined;
    paid?: undefined;
    cached?: undefined;
    note?: undefined;
    status?: undefined;
    payment?: undefined;
    serviceName?: undefined;
    endpoint?: undefined;
} | {
    success: boolean;
    status: number;
    data: unknown;
    paid: boolean | undefined;
    payment: {
        amount: string;
        token: PaymentToken;
        recipient: string;
    } | undefined;
    cached?: undefined;
    note?: undefined;
    error?: undefined;
    suggestion?: undefined;
    serviceName?: undefined;
    endpoint?: undefined;
} | {
    success: boolean;
    error: string;
    serviceName: string;
    endpoint: string;
    data?: undefined;
    paid?: undefined;
    cached?: undefined;
    note?: undefined;
    suggestion?: undefined;
    status?: undefined;
    payment?: undefined;
}>;

/**
 * Call Free API Tool
 * AI tool for calling regular (non-paid) HTTP APIs
 */
/**
 * Creates a tool for calling free (non-x402) HTTP APIs
 */
declare function createCallFreeApiTool(): ai.Tool<{
    method: "GET" | "POST" | "PUT" | "DELETE";
    url: string;
    headers?: Record<string, string> | undefined;
    body?: Record<string, unknown> | undefined;
}, {
    success: boolean;
    status: number;
    statusText: string;
    data: unknown;
    error?: undefined;
    url?: undefined;
} | {
    success: boolean;
    error: string;
    url: string;
    status?: undefined;
    statusText?: undefined;
    data?: undefined;
}>;

export { ALGOD_MAINNET_URL, ALGOD_TESTNET_URL, ALGORAND_MAINNET_CAIP2, ALGORAND_TESTNET_CAIP2, type AgentConfig, AlgoPeAgent, type AlgoPeAgentOptions, CONFIG_PATH, type CallPaidApiToolOptions, type ConfigBuilder, DEFAULT_MODELS, DEFAULT_REGISTRY_PATH, type DiscoverServiceToolOptions, type HttpRequestOptions, type HttpResponse, INDEXER_MAINNET_URL, INDEXER_TESTNET_URL, type LLMConfig, type LLMMode, type LLMProvider, type LegacyWalletConfig, PaymentClient, type PaymentClientOptions, type PaymentConfig, type PaymentReceipt, type PaymentRequirementsHeader, type PaymentSummary, type PaymentToken, type Registry, RegistryClient, type RunOptions, type SearchOptions, type ServiceInfo, type StepInfo, type TaskResult, type ToolCallInfo, type ToolResultInfo, USDC_MAINNET_ASA_ID, USDC_TESTNET_ASA_ID, type WalletBalance, type WalletConfig, type WalletInstance, addressFromMnemonic, buildConfig, clearAllCredentials, configExists, createAgent, createAlgodClient, createCallFreeApiTool, createCallPaidApiTool, createDiscoverServiceTool, createPaymentClient, createWalletFromAddress, createWalletFromConfig, createWalletFromMnemonic, deleteMnemonic, findServiceById, findServiceByName, formatAmount, formatBalance, formatServiceForDisplay, getAllTags, getConfigPath, getCredentialInfo, getDefaultModel, getDefaultRegistryPath, getMnemonic, getServiceStats, getWalletBalance, getWalletMnemonic, hasMnemonic, hasSufficientBalance, isKeychainAvailable, isLegacyConfig, isValidAddress, isValidMnemonic, isWalletAvailable, listStoredWallets, loadConfig, loadRegistry, migrateToKeychain, migrateToSecureStorage, parseAmount, registryExists, saveConfig, saveMnemonic, saveWalletToKeychain, searchServices };
