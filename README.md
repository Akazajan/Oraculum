# Oraculum

> **A pay-per-query AI agent marketplace on Stellar** — autonomous intelligence agents (market analysts, life consultants, on-chain watchers) that anyone can query instantly, paying only in USDC, with zero accounts and persistent memory tied to your wallet.

[![Stellar](https://img.shields.io/badge/Network-Stellar-black?style=flat-square&logo=stellar)](https://stellar.org)
[![Soroban](https://img.shields.io/badge/Contracts-Soroban-7D00FF?style=flat-square)](https://soroban.stellar.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)
[![Drips Wave](https://img.shields.io/badge/Submitted-drips.network%2Fwave-purple?style=flat-square)](https://drips.network/wave)
[![Status](https://img.shields.io/badge/Status-Active%20Development-green?style=flat-square)]()

---

## What is Oraculum?

Two great ideas, one missing piece. **CeloSense** proved that an autonomous AI agent can monitor on-chain activity and sell insights pay-per-query through micropayments inside a wallet. **Numina AI** proved that a pay-per-use AI consultant — no account, no subscription, just a wallet address and USDC — can deliver deeply personal, persistent value (a numerology profile, a 1:1 AI coach).

**Oraculum unifies both patterns into a single protocol**: an open marketplace of autonomous AI Oracle Agents on Stellar. Each agent is a specialized intelligence — a whale-watcher, a market analyst, a life consultant, a legal-document summarizer, whatever a builder wants to deploy — and every agent shares the same underlying primitives:

- **Pay-per-query micropayments** in USDC, settled instantly on Stellar
- **Wallet-native identity** — no sign-up, your Stellar address *is* your account
- **Persistent agent memory** — every agent remembers your history and context across sessions
- **Composable agent registry** — anyone can deploy a new oracle agent and list it in the marketplace
- **On-chain, auditable payment rail** — every query and payment is verifiable on the Stellar ledger

Where CeloSense was one agent (on-chain whale intelligence) and Numina was one agent (numerology + life coaching), **Oraculum is the protocol that lets both — and any future agent — exist side by side**, sharing payment rails, identity, and memory infrastructure.

---

## Inspiration

| Project | Inspiration |
|---|---|
| **CeloSense** (Celo) | Autonomous on-chain monitoring agent; pay-per-query micropayments via x402; wallet-embedded delivery (MiniPay) |
| **Numina AI** (Celo / MiniPay) | Wallet-address-based identity with no account system; client-side computation for instant free value; paid unlock for deep AI consultation; persistent reading/conversation history by wallet |
| **Ditto** (generative AI economy) | The remix-native, protocol-level economy idea — applied here as an *open agent registry* where any builder can permissionlessly deploy and monetize a new oracle agent |

**Combined projects: CeloSense + Numina AI** form the technical and product core of Oraculum — generalized from two single-purpose Celo apps into one multi-agent Stellar protocol. Ditto's remix-economy thinking shapes the open agent registry and revenue-sharing model.

---

## Core Features

### 1. Universal Pay-Per-Query Micropayments
Every agent interaction — a whale-alert query, a numerology unlock, a market-intelligence question — is metered and paid for individually in USDC via a Stellar-native micropayment primitive (`x402-soroban`, our adaptation of the x402 payment-required pattern to Soroban smart contracts).

```
GET /agents/whale-watch/query
402 Payment Required
→ Pay 0.10 USDC via Soroban contract call
→ Resubmit with payment proof
200 OK + response
```

### 2. Wallet-Native Identity (No Accounts, Ever)
There is no sign-up flow anywhere in Oraculum. Your Stellar wallet address is your identity, your payment method, and your history key. Connect a wallet, query an agent, done.

### 3. Free Tier + Paid Unlock Pattern
Inspired directly by Numina AI: every agent can expose a **free, client-side computable tier** (e.g., a basic numerology profile, a basic wallet summary) and a **paid deep tier** (full Personal Year cycle, 1:1 AI chat, deep whale-flow analytics) unlocked with a single USDC micropayment.

### 4. Persistent Agent Memory
Conversation and query history is stored per wallet address per agent, so users can pick up exactly where they left off — whether that's a numerology reading from last week or an ongoing thread with a market-intelligence agent about a specific token.

### 5. Open Agent Registry (Ditto-Inspired Remix Economy)
Any developer can register a new Oracle Agent in the **Oraculum Registry**, a Soroban smart contract that tracks agent metadata, pricing, and revenue splits. Agents can be:
- **Original** — built from scratch and registered
- **Remixed/Forked** — built on top of an existing agent's prompt template, data pipeline, or scoring model, with an automatic revenue share routed back to the original creator via Stellar payment streams

### 6. On-Chain Whale & Wallet Intelligence Agent (`SentryAgent`)
A direct generalization of CeloSense to Stellar: monitors wallet activity across the Stellar network, flags large or anomalous transfers, tracks DEX liquidity shifts, and answers natural-language questions about wallet behavior — all pay-per-query.

### 7. Numerology & Life Consultant Agent (`NuminaAgent`)
A direct port of Numina AI's product to the Oraculum framework: enter a name and birthday, get an instant client-side Pythagorean numerology profile (Life Path, Day Number, Soul Urge, Birth Chart) for free, then unlock Personal Year cycles, Life Pinnacles, and Core Challenges plus 1:1 AI chat for $0.50 USDC.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         Client Layer                              │
│   Web App  │  Wallet-Embedded Mini-App  │  CLI  │  Agent SDK     │
└────────────────────────────┬───────────────────────────────────-─┘
                             │
┌────────────────────────────▼──────────────────────────────────-──┐
│                     Oraculum Gateway                              │
│  Request routing │ x402-soroban payment middleware │ Auth-by-wallet │
└─────────┬──────────────────────────────────────────┬──────────-──┘
          │                                          │
┌─────────▼──────────────┐              ┌────────────▼──────────--──┐
│   Agent Registry        │              │     Stellar Ledger Layer   │
│  (Soroban contract)     │              │  • Soroban smart contracts │
│  • Agent metadata       │              │  • USDC payment settlement │
│  • Pricing & revenue    │              │  • Revenue-share streams   │
│    split rules          │              │  • Query receipts (proof)  │
└─────────┬──────────────┘              └─────────────────────────--─┘
          │
┌─────────▼─────────────────────────────────────────────────────-───┐
│                       Agent Runtime Layer                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐    │
│  │ SentryAgent  │  │ NuminaAgent  │  │  Future / 3rd-party    │   │
│  │ (on-chain    │  │ (numerology  │  │  agents (remixable,    │   │
│  │  intel)      │  │  + life AI)  │  │  permissionless)        │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘    │
└─────────┬───────────────────────────────────────────────────────-─┘
          │
┌─────────▼─────────────────────────────────────────────────────-───┐
│                    Memory & Data Layer                             │
│  Per-wallet conversation history │ Agent-specific state stores     │
└─────────────────────────────────────────────────────────────────-─┘
```

---

## Monorepo Structure

```
oraculum/
├── README.md
├── package.json                       # Workspace root
├── turbo.json                         # Turborepo pipeline config
├── .env.example
│
├── packages/
│   ├── contracts/                     # Soroban smart contracts (Rust)
│   │   ├── agent-registry/            # Agent registration, metadata, pricing
│   │   ├── x402-soroban/              # Pay-per-query payment primitive
│   │   ├── revenue-stream/            # Revenue-share streams for remixed agents
│   │   └── query-receipt/             # On-chain proof-of-payment / proof-of-query
│   │
│   ├── agent-runtime/                 # Core agent execution framework (TypeScript)
│   │   ├── src/
│   │   │   ├── base-agent/            # Abstract Agent class all agents extend
│   │   │   ├── memory/                # Per-wallet conversation/state persistence
│   │   │   ├── billing/               # x402 payment-required middleware
│   │   │   └── registry-client/       # Reads/writes to agent-registry contract
│   │   └── README.md
│   │
│   ├── agents/
│   │   ├── sentry-agent/              # On-chain wallet/whale intelligence (from CeloSense)
│   │   │   ├── src/
│   │   │   │   ├── monitors/          # Wallet activity & whale movement watchers
│   │   │   │   ├── flagging/          # Anomaly & large-transfer detection
│   │   │   │   └── query-handler/     # Natural-language Q&A over on-chain data
│   │   │   └── Dockerfile
│   │   │
│   │   └── numina-agent/              # Numerology + AI life consultant (from Numina AI)
│   │       ├── src/
│   │       │   ├── numerology-engine/ # Pythagorean calculations (client + server)
│   │       │   ├── profile/           # Life Path, Day Number, Soul Urge, Birth Chart
│   │       │   ├── unlock-tier/       # Personal Year, Pinnacles, Core Challenges
│   │       │   └── chat/              # 1:1 AI consultant chat, profile-aware
│   │       └── Dockerfile
│   │
│   ├── gateway/                       # Oraculum Gateway API (Node.js / TypeScript)
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   ├── middleware/
│   │   │   │   └── x402.ts            # 402 Payment Required handling
│   │   │   └── stellar/               # Stellar SDK integration
│   │   └── Dockerfile
│   │
│   ├── sdk/                           # Client SDK (TypeScript)
│   │   ├── src/
│   │   │   ├── query.ts               # Query any agent, handle 402 payment flow
│   │   │   ├── registry.ts            # Browse/register agents
│   │   │   ├── wallet.ts              # Wallet connect & identity helpers
│   │   │   └── types.ts
│   │   └── README.md
│   │
│   ├── agent-sdk/                     # Build-your-own-agent SDK for third-party devs
│   │   ├── src/
│   │   │   ├── create-agent.ts        # Scaffold a new agent
│   │   │   ├── remix-agent.ts         # Fork an existing agent with revenue share
│   │   │   └── publish.ts             # Register agent on-chain
│   │   └── README.md
│   │
│   └── shared/                        # Shared types & utilities
│       ├── src/
│       │   ├── types/
│       │   └── constants/
│       └── tsconfig.json
│
├── apps/
│   ├── web/                           # Web marketplace + agent UIs (Next.js)
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── marketplace/       # Browse all agents
│   │   │   │   ├── sentry/            # SentryAgent UI
│   │   │   │   └── numina/            # NuminaAgent UI
│   │   │   ├── components/
│   │   │   └── hooks/
│   │   └── package.json
│   │
│   ├── mini-app/                      # Wallet-embedded mini-app (MiniPay-style, for Stellar wallets)
│   │   ├── src/
│   │   └── package.json
│   │
│   ├── cli/                           # Command-line interface (Node.js)
│   │   ├── src/
│   │   │   ├── commands/
│   │   │   │   ├── query.ts
│   │   │   │   ├── agents.ts
│   │   │   │   └── history.ts
│   │   └── package.json
│   │
│   └── docs/                          # Documentation site (Astro)
│       ├── src/content/
│       └── package.json
│
├── infra/
│   ├── docker-compose.yml             # Local dev stack
│   ├── docker-compose.prod.yml
│   ├── terraform/
│   └── k8s/
│
└── scripts/
    ├── deploy-contracts.sh            # Deploy Soroban contracts
    ├── seed-testnet.sh                # Seed Stellar testnet accounts
    ├── register-agent.sh              # Register a new agent on-chain
    └── generate-types.sh              # Generate contract bindings
```

---

## Getting Started

### Prerequisites

- Node.js >= 20
- Rust >= 1.75 (for Soroban contracts)
- Docker & Docker Compose
- [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/cli/stellar-cli)
- A funded Stellar testnet account ([Friendbot](https://developers.stellar.org/docs/tools/developer-tools/friendbot))

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/oraculum.git
cd oraculum

# Install all workspace dependencies
npm install

# Copy environment variables
cp .env.example .env
# Edit .env with your Stellar testnet keys and config
```

### Running Locally

```bash
# Start the full local stack (gateway, agents, web app)
docker-compose up -d

# Deploy Soroban contracts to Stellar testnet
npm run contracts:deploy:testnet

# Register the built-in agents (SentryAgent, NuminaAgent)
npm run scripts:register-agent -- --agent sentry
npm run scripts:register-agent -- --agent numina

# Start all apps and packages in dev mode
npm run dev
```

### Running Tests

```bash
# All packages
npm run test

# Contracts only (Soroban unit tests)
npm run test --workspace=packages/contracts

# A specific agent
npm run test --workspace=packages/agents/sentry-agent
npm run test --workspace=packages/agents/numina-agent
```

---

## Smart Contracts

All contracts are written in Rust and deployed on **Stellar's Soroban** smart contract platform.

### `agent-registry`
The on-chain directory of every agent in the marketplace. Stores agent metadata, pricing per query/unlock tier, owner address, and parent-agent reference (for remixed/forked agents).

```rust
fn register_agent(env: Env, owner: Address, metadata: AgentMetadata, parent: Option<AgentId>) -> AgentId;
fn get_agent(env: Env, agent_id: AgentId) -> AgentMetadata;
fn update_pricing(env: Env, agent_id: AgentId, owner: Address, new_price: i128);
fn list_agents(env: Env, category: Option<Category>) -> Vec<AgentId>;
```

### `x402-soroban`
The core pay-per-query primitive. Implements an HTTP-402-inspired payment-required flow natively as a Soroban contract call: a query is rejected until a matching USDC payment is verified on-chain, then a signed receipt authorizes the response.

```rust
fn request_payment(env: Env, agent_id: AgentId, payer: Address, amount: i128) -> PaymentRequest;
fn settle_payment(env: Env, request_id: PaymentRequestId, payer: Address) -> QueryReceipt;
fn verify_receipt(env: Env, receipt: QueryReceipt) -> bool;
```

### `revenue-stream`
Routes a percentage of every paid query on a remixed agent back to the original creator, streamed continuously in USDC.

```rust
fn open_stream(env: Env, agent_id: AgentId, recipient: Address, share_bps: u32);
fn distribute(env: Env, agent_id: AgentId, total_amount: i128);
fn claim(env: Env, recipient: Address) -> i128;
```

### `query-receipt`
Issues an on-chain, verifiable receipt for every completed paid query — the auditable trail of "who paid whom for what."

```rust
fn issue_receipt(env: Env, agent_id: AgentId, payer: Address, query_hash: BytesN<32>) -> ReceiptId;
fn get_receipt(env: Env, receipt_id: ReceiptId) -> Receipt;
```

---

## Agent Spotlight: SentryAgent

Generalized from **CeloSense** — an autonomous on-chain intelligence agent for the Stellar network.

### Capabilities
- Monitors wallet activity in real time across the Stellar ledger
- Flags whale movements (large transfers, sudden liquidity shifts on Stellar DEX/AMM pools)
- Answers natural-language questions: *"Has wallet G...XYZ moved more than 10,000 USDC this week?"*
- Delivers insights pay-per-query, billed via `x402-soroban`

### Pricing (example)
| Query Type | Price |
|---|---|
| Basic wallet summary | Free |
| Whale alert subscription (per alert) | $0.05 USDC |
| Deep wallet analysis (full history + pattern detection) | $0.25 USDC |
| Custom natural-language query | $0.10 USDC |

---

## Agent Spotlight: NuminaAgent

Generalized from **Numina AI** — an on-chain numerology oracle and AI life consultant.

### Capabilities
- Enter name and birthday → instant **free**, client-side Pythagorean numerology profile:
  - Life Path Number
  - Day Number
  - Soul Urge Number
  - Birth Chart
- Pay **$0.50 USDC** to unlock:
  - Personal Year cycle
  - Life Pinnacles timeline
  - Core Challenges
  - 1:1 chat with NuminaAgent — an AI consultant aware of your full profile, responding like a sharp, warm personal coach
- Reading and conversation history persisted by wallet address — pick up exactly where you left off, no account needed

### Pricing
| Tier | Price |
|---|---|
| Basic profile (Life Path, Day Number, Soul Urge, Birth Chart) | Free, computed client-side |
| Full unlock (Personal Year, Pinnacles, Core Challenges + AI chat) | $0.50 USDC, one-time per profile |

---

## Pay-Per-Query Flow (x402-soroban)

```
1. User queries an agent (e.g., "What's my Personal Year cycle?")
        │
        ▼
2. Gateway checks: is this tier free or paid?
        │
        ├── Free tier ──► Compute & respond immediately (often client-side)
        │
        └── Paid tier
                │
                ▼
        3. Gateway responds 402 Payment Required + payment details
                │
                ▼
        4. Client SDK prompts wallet to sign a USDC payment to the agent's contract
                │
                ▼
        5. Soroban contract verifies payment, issues a QueryReceipt
                │
                ▼
        6. Client resubmits query with receipt
                │
                ▼
        7. Agent processes query, returns full response
                │
                ▼
        8. Conversation/result persisted under user's wallet address
```

---

## SDK Usage

### Query an Agent

```typescript
import { OraculumClient } from '@oraculum/sdk';

const client = new OraculumClient({
  network: 'testnet',
  keypair: StellarSdk.Keypair.fromSecret('S...'),
});

// Free tier — numerology basic profile
const profile = await client.query('numina-agent', {
  type: 'basic-profile',
  name: 'Ada Lovelace',
  birthday: '1815-12-10',
});

console.log(profile.lifePath, profile.dayNumber, profile.soulUrge);

// Paid tier — automatically handles the 402 payment flow
const fullReading = await client.query('numina-agent', {
  type: 'full-unlock',
  profileId: profile.id,
});

console.log(`Paid ${fullReading.amountPaid} USDC`);
console.log(fullReading.personalYear, fullReading.lifePinnacles);
```

### Chat With an Agent

```typescript
const chat = await client.chat('numina-agent', {
  profileId: profile.id,
  message: "What should I focus on this year?",
});

console.log(chat.response);
```

### Query SentryAgent

```typescript
const alert = await client.query('sentry-agent', {
  type: 'whale-check',
  walletAddress: 'GABC...XYZ',
  threshold: '10000',
  currency: 'USDC',
});

console.log(alert.flagged, alert.transactions);
```

### Build & Remix Your Own Agent

```typescript
import { createAgent, remixAgent } from '@oraculum/agent-sdk';

// Create an original agent
const myAgent = await createAgent({
  name: 'TarotAgent',
  description: 'AI tarot reading oracle',
  pricing: { freeTier: 'single-card-draw', paidTier: { price: '0.30', currency: 'USDC' } },
});

// Or remix an existing one, with automatic revenue share to the original creator
const remixed = await remixAgent({
  parentAgentId: 'numina-agent',
  name: 'AstroNumina',
  revenueShareToParentBps: 1500, // 15% to NuminaAgent's creator
});
```

---

## CLI Usage

```bash
# List all available agents in the marketplace
oraculum agents list

# Query an agent (handles payment automatically via connected wallet)
oraculum query numina-agent --name "Ada Lovelace" --birthday 1815-12-10

# Chat with an agent
oraculum chat numina-agent --message "What should I focus on this year?"

# Check whale activity via SentryAgent
oraculum query sentry-agent --wallet G...XYZ --check-whale

# View your query/payment history
oraculum history --agent numina-agent
```

---

## Revenue Model

| Flow | Mechanism |
|---|---|
| User pays for a query | USDC settled instantly via `x402-soroban` |
| Agent creator earns | Receives query revenue directly, minus protocol fee |
| Protocol fee | Small % (e.g., 2.5%) routed to the Oraculum treasury for protocol maintenance |
| Remixed agent revenue share | Automatic % routed to original creator via `revenue-stream`, configurable per remix |
| Free tier | Computed client-side or subsidized by the agent creator as a growth/marketing layer |

---

## Roadmap

### Phase 1 — Foundation (Q3 2025)
- [ ] Core Soroban contracts (`agent-registry`, `x402-soroban`) on testnet
- [ ] SentryAgent MVP — basic wallet monitoring & whale flagging
- [ ] NuminaAgent MVP — free numerology profile + paid unlock
- [ ] Gateway with 402 payment-required middleware
- [ ] Client SDK v0.1, CLI v0.1

### Phase 2 — Marketplace (Q4 2025)
- [ ] Web marketplace UI — browse, query, and chat with all agents
- [ ] Wallet-embedded mini-app for Stellar-native wallets
- [ ] `revenue-stream` contract live — remix/fork revenue sharing
- [ ] Agent SDK for third-party developers

### Phase 3 — Expansion (Q1 2026)
- [ ] Open agent submission & community curation
- [ ] Additional first-party agents (e.g., legal-doc summarizer, DeFi yield analyst)
- [ ] On-chain reputation scoring for agents (accuracy, response quality)
- [ ] Mainnet launch

### Phase 4 — Governance (Q2 2026)
- [ ] Protocol fee parameters governed by community
- [ ] Agent quality/dispute resolution DAO
- [ ] Grants program for new agent builders

---

## Contributing

We welcome contributions of all kinds — new agents, core protocol improvements, documentation, and feedback.

```bash
# Fork the repo and create a feature branch
git checkout -b feat/your-feature

# Make your changes and run tests
npm run test

# Submit a pull request
```

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR. All contributors must agree to our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## Security

Found a security vulnerability? Please **do not** open a public GitHub issue. Email `security@oraculum.xyz` with a description of the vulnerability and steps to reproduce. We aim to respond within 48 hours.

---

## License

This project is licensed under the **MIT License** — see [LICENSE](LICENSE) for details.

---

## Acknowledgements

Oraculum is inspired by and builds upon the work of:

- [Stellar Development Foundation](https://stellar.org) — for Soroban and native USDC settlement
- [CeloSense](https://celosense.xyz) — for proving autonomous on-chain agents can sell intelligence pay-per-query
- [Numina AI](https://numina.ai) — for the wallet-native, account-free product pattern with free + paid unlock tiers
- [Ditto](https://ditto.xyz) — for the remix-native economy thinking behind our open agent registry

---

<div align="center">
*Oraculum — Ask Anything. Pay Only For What You Use.*
</div>