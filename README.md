# Oraculum

> **A pay-per-query AI agent marketplace on Stellar** — autonomous intelligence agents (market analysts, life consultants, on-chain watchers) that anyone can query instantly, paying only in USDC, with zero accounts and persistent memory tied to your wallet.

[![Stellar](https://img.shields.io/badge/Network-Stellar-black?style=flat-square&logo=stellar)](https://stellar.org)
[![Soroban](https://img.shields.io/badge/Contracts-Soroban-7D00FF?style=flat-square)](https://soroban.stellar.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)
[![Status](https://img.shields.io/badge/Status-Active%20Development-green?style=flat-square)]()

---

## What is Oraculum?

**CeloSense** proved an AI agent can monitor on-chain activity and sell insights pay-per-query. **Numina AI** proved a pay-per-use AI consultant — no account, just a wallet and USDC — can deliver deeply personal value.

**Oraculum unifies both into one protocol**: an open marketplace of autonomous AI Oracle Agents on Stellar, sharing common primitives:

- **Pay-per-query micropayments** in USDC, settled instantly via `x402-soroban`
- **Wallet-native identity** — no sign-up, your Stellar address *is* your account
- **Persistent agent memory** — agents remember your history across sessions
- **Open agent registry** — anyone can deploy and monetize a new oracle agent
- **On-chain, auditable payment rail** — every query is verifiable on the ledger

Two flagship agents ship at launch: **SentryAgent** (on-chain whale/wallet intelligence, generalized from CeloSense) and **NuminaAgent** (numerology + AI life consultant, generalized from Numina AI). Both run on the same payment, identity, and memory infrastructure — and any third party can add the next one.

---

## Inspiration

| Project | Inspiration |
|---|---|
| **CeloSense** | Autonomous on-chain monitoring; pay-per-query via x402; wallet-embedded delivery |
| **Numina AI** | Wallet-based identity, no accounts; free tier + paid AI consultation unlock; persistent history by wallet |
| **Ditto** | Remix-native economy — applied here as a permissionless agent registry with revenue sharing |

---

## How It Works

```
GET /agents/whale-watch/query
402 Payment Required → pay 0.10 USDC via Soroban → resubmit with receipt
200 OK + response
```

1. **Free tier** — basic value computed instantly, often client-side, no wallet needed
2. **Paid tier** — one USDC micropayment unlocks deep agent output (analysis, full reading, 1:1 chat)
3. **Memory** — every interaction is saved per wallet address, so you pick up where you left off
4. **Remix economy** — fork an existing agent's logic; a revenue share streams back to its creator automatically

---

## Architecture

```
Client (Web / Mini-App / CLI)
        │
        ▼
Oraculum Gateway  →  x402 payment middleware, auth-by-wallet, agent routing
        │                              │
        ▼                              ▼
Agent Runtime               Stellar Ledger (Soroban)
 • SentryAgent                • agent-registry
 • NuminaAgent                • x402-soroban
 • 3rd-party agents           • revenue-stream / query-receipt
        │
        ▼
Memory Layer (per-wallet conversation & state)
```

Full diagrams and per-layer detail live in the layer READMEs linked below.

---

## Monorepo Structure

```
oraculum/
├── packages/
│   ├── contracts/        # Soroban smart contracts (Rust) — see Contracts README
│   ├── agent-runtime/     # Shared agent framework (TypeScript)
│   ├── agents/
│   │   ├── sentry-agent/  # On-chain intelligence (from CeloSense)
│   │   └── numina-agent/  # Numerology + AI consultant (from Numina AI)
│   ├── gateway/           # API + x402 middleware — see Backend README
│   ├── sdk/                # Client SDK
│   ├── agent-sdk/          # Build/remix-your-own-agent SDK
│   └── shared/              # Shared types & utilities
├── apps/
│   ├── web/                 # Marketplace UI (Next.js) — see Frontend README
│   ├── mini-app/             # Wallet-embedded mini-app
│   ├── cli/                   # Command-line client
│   └── docs/                   # Documentation site
├── infra/                       # Docker, Terraform, k8s
└── scripts/                      # Deploy & dev scripts
```

**Layer-specific documentation:**
- [`packages/contracts/README.md`](packages/contracts/README.md) — Soroban contracts
- [`packages/gateway/README.md`](packages/gateway/README.md) — backend, agent runtime
- [`apps/web/README.md`](apps/web/README.md) — frontend, wallet UX

---

## Getting Started

```bash
git clone https://github.com/your-org/oraculum.git
cd oraculum
npm install
cp .env.example .env   # add Stellar testnet keys

docker-compose up -d                          # gateway, agents, web app
npm run contracts:deploy:testnet              # deploy Soroban contracts
npm run scripts:register-agent -- --agent sentry
npm run scripts:register-agent -- --agent numina
npm run dev                                   # start everything
```

Prerequisites: Node.js ≥ 20, Rust ≥ 1.75, Docker, [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/cli/stellar-cli), a funded testnet account via [Friendbot](https://developers.stellar.org/docs/tools/developer-tools/friendbot).

```bash
npm run test                                              # all packages
npm run test --workspace=packages/contracts                # contracts only
```

---

## Agent Spotlight

### SentryAgent (from CeloSense)
Monitors Stellar wallet activity, flags whale movements, answers natural-language questions about on-chain behavior.

| Query | Price |
|---|---|
| Basic wallet summary | Free |
| Whale alert | $0.05 USDC |
| Deep wallet analysis | $0.25 USDC |

### NuminaAgent (from Numina AI)
Enter a name and birthday for an instant free numerology profile (Life Path, Day Number, Soul Urge, Birth Chart). Unlock Personal Year, Life Pinnacles, Core Challenges, and 1:1 AI chat for **$0.50 USDC**, saved by wallet address.

---

## SDK Quick Example

```typescript
import { OraculumClient } from '@oraculum/sdk';

const client = new OraculumClient({ network: 'testnet', keypair });

const profile = await client.query('numina-agent', {
  type: 'basic-profile', name: 'Ada Lovelace', birthday: '1815-12-10',
});

// Paid tier — SDK handles the 402 payment flow automatically
const reading = await client.query('numina-agent', { type: 'full-unlock', profileId: profile.id });
```

Full SDK, agent-remix, and CLI reference: [`packages/sdk/README.md`](packages/sdk/README.md).

---

## Revenue Model

| Flow | Mechanism |
|---|---|
| User pays per query | USDC, settled instantly via `x402-soroban` |
| Agent creator earns | Query revenue minus protocol fee (~2.5%) |
| Remix revenue share | Automatic % to original creator via `revenue-stream` |
| Free tier | Client-side compute or creator-subsidized growth layer |

---

## Roadmap

| Phase | Focus |
|---|---|
| **1 — Foundation** (Q3 2025) | Core contracts on testnet, SentryAgent + NuminaAgent MVPs, Gateway, SDK v0.1 |
| **2 — Marketplace** (Q4 2025) | Web marketplace, mini-app, `revenue-stream` live, third-party Agent SDK |
| **3 — Expansion** (Q1 2026) | Open agent submissions, reputation scoring, mainnet launch |
| **4 — Governance** (Q2 2026) | Community-governed fees, dispute-resolution DAO, builder grants |

---

## Contributing

```bash
git checkout -b feat/your-feature
npm run test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before opening a PR.

## Security

Do not open public issues for vulnerabilities. Email `security@oraculum.xyz` — we respond within 48 hours.

## License

[MIT](LICENSE)

## Acknowledgements

Built on [Stellar](https://stellar.org) and Soroban. Inspired by **CeloSense** (pay-per-query agent pattern), **Numina AI** (wallet-native free/paid product), and **Ditto** (remix-native economy).

---

<div align="center">

*Oraculum — Ask Anything. Pay Only For What You Use.*

</div>