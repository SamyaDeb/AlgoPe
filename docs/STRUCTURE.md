# AlgoPe Project Structure

Clean and organized folder structure for AlgoPe AI Agent Marketplace.

## Root Directory

```
algope/
├── package.json               # Root package config (npm workspaces)
├── package-lock.json          # Dependency lock
├── tsconfig.json              # TypeScript config
│
├── LICENSE                    # MIT License
├── README.md                  # Main documentation
│
├── docs/                      # Project documentation
│   ├── ARCHITECTURE.md        # System design and payment flow
│   ├── STRUCTURE.md           # This file
│   ├── CHANGELOG.md           # Version history
│   ├── CONTRIBUTING.md        # Contribution guidelines
│   ├── SECURITY.md            # Security policy
│   └── README.md              # Docs index
│
├── .github/workflows/         # CI
│
├── contracts/                 # Smart Contracts
├── packages/                  # SDK Packages
├── examples/                  # Example Backend APIs
└── frontend/                  # Web Frontend
```

> For how these pieces interact at runtime, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## 📦 contracts/

Algorand smart contract for on-chain service registry.

```
contracts/
├── src/
│   ├── AlgoPeRegistry.algo.ts     # Contract source
│   └── out/                        # Compiled TEAL
├── scripts/
│   └── deploy.ts                   # Deployment script
├── package.json
└── tsconfig.json
```

**Registry App ID**: 769455464 (testnet)

---

## 📦 packages/

### packages/algope/ - Provider SDK

For API providers who want to monetize their services.

```
packages/algope/
├── src/
│   ├── cli.ts                 # CLI tool
│   ├── registry.ts            # On-chain registration
│   ├── proxy/                 # x402 payment proxy
│   ├── facilitator/           # ALGO payment handling
│   └── wallet-connect.ts      # Wallet integration
├── dist/                      # Built output
├── package.json
└── README.md
```

**Commands**:
- `npx algope init` - Register service on-chain
- `npx algope start` - Start x402 proxy
- `npx algope list` - View registered services

---

### packages/algope-agent/ - Consumer Agent SDK

For AI agents and consumers who want to discover and use paid services.

```
packages/algope-agent/
├── src/
│   ├── cli.ts                 # CLI tool
│   ├── agent.ts               # AI agent logic
│   ├── registry.ts            # On-chain discovery
│   ├── payment.ts             # x402 payment client
│   ├── wallet.ts              # Wallet management
│   └── tools/                 # AI tools
├── dist/                      # Built output
├── package.json
└── README.md
```

**Commands**:
- `npx algope-agent init` - Setup agent wallet
- `npx algope-agent run "query"` - Execute AI task

---

## 📦 examples/

Sample backend APIs for testing AlgoPe integration.

```
examples/
├── btc-api.mjs           # Bitcoin price API (port 3001)
├── weather-api.mjs       # Weather data API (port 3004)
└── README.md             # Usage guide
```

**Usage**:
```bash
cd examples/
node btc-api.mjs         # Start BTC API
node weather-api.mjs     # Start Weather API
```

---

## 🌐 frontend/

Web frontend application (empty - ready for development).

```
frontend/
└── README.md            # Setup instructions
```

**Suggested Tech Stack**:
- React + Vite
- Next.js
- React + TypeScript

---

## Files Removed

**Total: 30+ test/temporary files deleted**

### Root Level:
- Test files: `test-*.mjs` (7 files), `test-pera.html`
- Duplicate APIs: `trading-api.mjs`, `weather-api.mjs`, `weather-alt-api.mjs`
- Setup scripts: `register-weather-service.mjs`, `setup-weather-provider.mjs`, `start-weather-proxy.mjs`
- Other: `mock-server.mjs`, `example-payment-client.mjs`
- Shell scripts: `start-all.sh`, `stop-all.sh`, `status.sh`
- Redundant docs: `MANUAL-TESTING-GUIDE.md`, `TESTING*.md`, `QUICK*.md`

### packages/algope-agent/:
- `test-groq.mjs`, `test-groq2.mjs`, `test-groq3.mjs`, `test-groq4.mjs`

### Folders:
- `packages/demo-frontend/` (empty)

---

## Quick Start

### Provider:
```bash
cd examples/
node btc-api.mjs &

cd ../packages/algope
npx algope init
npx algope start
```

### Consumer:
```bash
cd packages/algope-agent
npx algope-agent init
npx algope-agent run "What is the Bitcoin price?"
```

---

**Last Updated**: March 20, 2026
