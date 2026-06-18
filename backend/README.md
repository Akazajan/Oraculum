# Oraculum — Backend

> The Gateway, Agent Runtime, and first-party agents (`SentryAgent`, `NuminaAgent`) powering Oraculum's pay-per-query AI marketplace on Stellar.

[![Node.js](https://img.shields.io/badge/Node.js-20-339933?style=flat-square&logo=node.js)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?style=flat-square&logo=typescript)]()

Covers `packages/gateway`, `packages/agent-runtime`, `packages/agents/*`. See [Root README](../../README.md) · [Frontend](../../apps/web/README.md) · [Contracts](../contracts/README.md).

---

## Architecture

```
Client → Gateway (auth-by-wallet → x402 middleware → agent router)
              │
              ▼
   Agent Runtime (BaseAgent, per-wallet memory store, billing helpers)
              │
       ┌──────┴──────┐
  SentryAgent    NuminaAgent
              │
              ▼
   Stellar / Soroban RPC (agent-registry, x402-soroban, revenue-stream)
```

The Gateway never embeds agent logic — it only routes, enforces payment, and handles identity. Each agent extends `BaseAgent` and is loaded based on the on-chain registry.

---

## Quick Start

```bash
# Prereqs: Node >= 20, Docker, Soroban contracts deployed to testnet, an LLM API key

cp packages/gateway/.env.example packages/gateway/.env
```

```bash
# .env
PORT=4000
DATABASE_URL=postgres://oraculum:oraculum@localhost:5432/oraculum
REDIS_URL=redis://localhost:6379
STELLAR_NETWORK=testnet
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
AGENT_REGISTRY_CONTRACT_ID=CDEF...
X402_CONTRACT_ID=CGHI...
USDC_CONTRACT_ID=CABC...
LLM_API_KEY=sk-...
LLM_PROVIDER=anthropic
```

```bash
docker-compose -f infra/docker-compose.yml up -d postgres redis
npm run db:migrate --workspace=packages/gateway
npm run dev --workspace=packages/gateway   # → http://localhost:4000
```

Agents run **in-process** (imported as libraries, simplest for dev) or as **microservices** (independent scaling), set via `AGENT_DEPLOYMENT_MODE`.

---

## The x402 Payment Middleware

Every paid endpoint follows the HTTP 402 pattern, backed by real on-chain settlement:

```typescript
export function requirePayment(priceUSDC: string) {
  return async (req, res, next) => {
    const receipt = req.headers['x-oraculum-receipt'];
    if (!receipt) {
      const paymentRequest = await X402Contract.requestPayment({
        agentId: req.params.agentId, payer: req.walletAddress, amount: toStroops(priceUSDC),
      });
      return res.status(402).json({ error: 'Payment Required', paymentRequest, amount: priceUSDC });
    }
    const valid = await X402Contract.verifyReceipt(receipt);
    if (!valid) return res.status(402).json({ error: 'Invalid or expired receipt' });
    next();
  };
}

router.post('/agents/numina-agent/unlock', authenticateWallet, requirePayment('0.50'), numinaAgent.handleUnlock);
```

**Flow:** client POSTs without receipt → 402 + `PaymentRequest` → client signs payment on-chain → contract returns `QueryReceipt` → client resubmits with `X-Oraculum-Receipt` header → Gateway verifies (cached in Redis, 5 min) → agent handles request.

---

## Auth-by-Wallet

No passwords or accounts — identity is proven via a signed challenge (`GET /auth/challenge?address=G...`), verified against the wallet's public key. The SDK handles this transparently per session.

---

## Agent Runtime

Every agent extends `BaseAgent`, giving consistent memory, billing, and registry behavior:

```typescript
export abstract class BaseAgent {
  abstract id: string;
  abstract freeTier(input: unknown): Promise<unknown>;
  abstract paidTier(input: unknown, walletAddress: string): Promise<unknown>;

  async getMemory(wallet: string) { return MemoryStore.get(this.id, wallet); }
  async chat(wallet: string, message: string) {
    const memory = await this.getMemory(wallet);
    return this.runChatCompletion(memory, message);
  }
}
```

Memory persists per `(agent_id, wallet_address)` in Postgres — this is what enables "pick up where you left off."

---

## SentryAgent (from CeloSense)

Monitors Stellar on-chain activity, flags whale movements, answers natural-language wallet questions.

| Endpoint | Tier | Price |
|---|---|---|
| `GET /agents/sentry-agent/summary/:wallet` | Free | — |
| `POST /agents/sentry-agent/whale-check` | Paid | $0.05 USDC |
| `POST /agents/sentry-agent/deep-analysis` | Paid | $0.25 USDC |

A background worker subscribes to Horizon's streaming API, writes flagged events to Postgres for these endpoints to query.

---

## NuminaAgent (from Numina AI)

Computes Pythagorean numerology profiles; offers an AI life consultant chat.

| Endpoint | Tier | Price |
|---|---|---|
| `POST /agents/numina-agent/basic-profile` | Free | — (also client-side) |
| `POST /agents/numina-agent/unlock` | Paid | $0.50 USDC |
| `POST /agents/numina-agent/chat` | Paid | included in unlock |

The same `numerology-engine` module is isomorphic — the frontend computes the free tier client-side, the backend uses an identical implementation for paid tier + chat context, guaranteeing consistency.

```typescript
function buildSystemPrompt(profile: NumerologyProfile) {
  return `You are Numina, a sharp, warm personal numerology coach.
Life Path: ${profile.lifePath} | Soul Urge: ${profile.soulUrge} | Personal Year: ${profile.personalYear}
Respond with grounded, specific guidance tied to these numbers.`;
}
```

---

## Background Jobs

| Job | Schedule | Purpose |
|---|---|---|
| `registry-sync` | Every 60s | Refresh local agent registry cache from chain |
| `wallet-watcher` | Streaming | SentryAgent's Horizon subscription |
| `receipt-cleanup` | Hourly | Purge expired payment receipt cache |
| `revenue-distribution` | Daily | Trigger remix revenue payouts |

---

## Core Tables

```sql
agent_memory (agent_id, wallet_address, state, conversation, updated_at)
agent_registry_cache (agent_id, name, owner_address, pricing, parent_agent_id, synced_at)
query_log (id, agent_id, wallet_address, receipt_id, amount_usdc, query_hash, created_at)
```

---

## Testing

```bash
npm run test --workspace=packages/gateway
npm run test --workspace=packages/agents/sentry-agent
npm run test --workspace=packages/agents/numina-agent
npm run test:integration --workspace=packages/gateway
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `STELLAR_RPC_URL` | Soroban RPC endpoint |
| `AGENT_REGISTRY_CONTRACT_ID` / `X402_CONTRACT_ID` / `USDC_CONTRACT_ID` | Deployed contract IDs |
| `LLM_API_KEY` / `LLM_PROVIDER` | Powers chat & NL query agents |
| `AGENT_DEPLOYMENT_MODE` | `in-process` or `microservice` |

---

## Related Docs

[Root README](../../README.md) · [Frontend](../../apps/web/README.md) · [Contracts](../contracts/README.md) · [SDK](../sdk/README.md)