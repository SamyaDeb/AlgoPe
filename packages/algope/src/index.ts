/**
 * AlgoPe - Provider SDK
 * Monetize any API with x402 micropayments on Algorand
 */

// Types
export * from "./types.js";

// Proxy Server
export {
  createProxyServer,
  startProxyServer,
  analytics,
  Analytics,
  createRoutesConfig,
  formatRoutesForDisplay,
} from "./proxy/index.js";
export type { RoutesConfig } from "./proxy/index.js";

// Algorand helpers
export {
  createAlgodClient,
  isValidAlgorandAddress,
  isValidMnemonic,
  addressFromMnemonic,
  getAccountInfo,
  formatAlgo,
  parseAmount,
} from "./facilitator/index.js";

// Facilitators — who verifies and settles x402 payments
export {
  resolveFacilitator,
  createGoPlausibleFacilitator,
  probeFacilitator,
  schemeForToken,
  caip2For,
} from "./facilitator/index.js";
export type {
  FacilitatorMode,
  ResolvedFacilitator,
  ResolveFacilitatorOptions,
  GoPlausibleFacilitatorOptions,
  FacilitatorProbeResult,
} from "./facilitator/index.js";

// On-Chain Registry
export { AlgoPeRegistryClient, onChainToServiceRegistration } from "./registry.js";
export type { RegistrationResult, OnChainService } from "./registry.js";

// Logger
export { logger, setLogLevel, getLogLevel, logPayment, logRequest, logServerStart } from "./logger.js";
