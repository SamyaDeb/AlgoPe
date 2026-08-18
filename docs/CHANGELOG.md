# Changelog

All notable changes to AlgoPe are documented here.

## [1.0.0] - 2024-07

### Added
- Initial release of AlgoPe x402 reverse proxy gateway
- `algope init` — interactive setup wizard saving config to `.env`
- `algope start` — starts the proxy reading from `.env`
- Optimistic proxying: verify locally (~10ms), proxy immediately, settle on-chain asynchronously
- Local Avalanche facilitator — full on-chain verify/settle for Fuji and C-Chain mainnet
- Per-route pricing via `routes.json`
- Admin endpoints: `/algope-admin/stats` and `/algope-admin/health`
- In-memory rate limiting per IP
- Graceful shutdown with settlement queue draining
- Structured JSON logging with `verbose` / `normal` / `quiet` levels
- `ALGOPE_LOG_LEVEL` environment variable support
- Programmatic API: `startProxyServer()` exported from package root
- Full TypeScript types exported for all public interfaces
