# Oraculum — Frontend

> Client layer of Oraculum: web marketplace, wallet-embedded mini-app, and CLI. Browse agents, connect a Stellar wallet, query and pay per use — no accounts.

[![Next.js](https://img.shields.io/badge/Next.js-14-black?style=flat-square&logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?style=flat-square&logo=typescript)]()

Covers `apps/web`, `apps/mini-app`, `apps/cli`. See [Root README](../../README.md) · [Backend](../../packages/gateway/README.md) · [Contracts](../../packages/contracts/README.md).

---

## What Lives Here

| App | Purpose | Stack |
|---|---|---|
| `apps/web` | Marketplace UI — browse, query, chat, history | Next.js 14, Tailwind, shadcn/ui |
| `apps/mini-app` | Lightweight wallet-embedded experience | Vite + React |
| `apps/cli` | Terminal client | Node.js, Commander.js |

All three consume [`@oraculum/sdk`](../../packages/sdk/README.md) for queries, payments, and wallet handling — UI stays thin, protocol logic stays in the SDK.

---

## Quick Start

```bash
# Prereqs: Node >= 20, a Stellar wallet (Freighter), funded testnet account, gateway running locally

npm install
cp apps/web/.env.example apps/web/.env.local
```

```bash
# .env.local
NEXT_PUBLIC_ORACULUM_GATEWAY_URL=http://localhost:4000
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_USDC_CONTRACT_ID=CABC...
NEXT_PUBLIC_AGENT_REGISTRY_CONTRACT_ID=CDEF...
```

```bash
npm run dev --workspace=apps/web        # → http://localhost:3000
npm run dev --workspace=apps/mini-app   # → http://localhost:5173
npm run build --workspace=apps/cli && npm link --workspace=apps/cli
```

---

## Directory Structure

```
apps/web/src/
├── app/
│   ├── marketplace/[agentId]/   # Agent listing + detail pages
│   ├── sentry/                  # SentryAgent UI
│   ├── numina/                  # Profile entry, unlock, chat
│   └── history/                 # Per-wallet query/payment history
├── components/
│   ├── wallet/                  # ConnectButton, WalletProvider, BalanceBadge
│   ├── agents/                  # AgentCard, AgentGrid, PricingTable
│   ├── payment/                 # PaymentModal (402 → sign → settle)
│   ├── numina/                  # NumerologyForm, ProfileCard, ChatWindow
│   └── sentry/                  # WalletSearchBar, WhaleAlertFeed
├── hooks/                       # useWallet, useAgentQuery, usePaymentFlow
└── lib/                         # oraculum-client.ts, stellar.ts
```

`apps/mini-app` mirrors this with a single-screen flow (`AgentList → QueryScreen → PaymentScreen`). `apps/cli` exposes `agents`, `query`, `chat`, `history` commands.

---

## Wallet Connection

Uses [Stellar Wallets Kit](https://github.com/Creit-Tech/Stellar-Wallets-Kit) to support Freighter, xBull, Albedo, Lobstr behind one interface. No sign-up step — the connected address is immediately the identity key for queries, history, and payments.

```tsx
const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  modules: [new FreighterModule(), new xBullModule()],
});

await kit.openModal({
  onWalletSelected: async (option) => {
    kit.setWallet(option.id);
    const { address } = await kit.getAddress();
    return address;
  },
});
```

---

## The 402 Payment Flow (Frontend Side)

```tsx
function usePaymentFlow() {
  const client = useOraculumClient();
  const [status, setStatus] = useState<'idle' | 'paying' | 'done' | 'error'>('idle');

  async function runQuery(agentId: string, payload: object) {
    return client.query(agentId, payload, {
      onPaymentRequired: async (req) => {
        setStatus('paying');
        return client.payments.settle(req); // prompts wallet signature
      },
    });
  }
  return { runQuery, status };
}
```

```tsx
<UnlockButton
  label={status === 'paying' ? 'Confirm in wallet...' : 'Unlock for $0.50 USDC'}
  onClick={() => runQuery('numina-agent', { type: 'full-unlock', profileId })}
/>
```

The user only sees a price, a button, and a wallet signature prompt — payment construction and receipt verification are abstracted by the SDK.

---

## UI Patterns

**NuminaAgent** — free tier computed client-side (no wallet needed); paid unlock ($0.50 USDC) reveals Personal Year, Pinnacles, Core Challenges, and chat.

**SentryAgent** — free basic wallet summary; paid deep analysis ($0.25 USDC) for whale-pattern detection.

---

## Conventions

- No `localStorage`/`sessionStorage` for wallet session state — lives in React context only
- Query history is always fetched fresh from the Gateway, keyed by wallet address
- No optimistic UI for payments — wait for on-chain confirmation before showing success

---

## Testing & Build

```bash
npm run test --workspace=apps/web        # Vitest + Testing Library
npm run test:e2e --workspace=apps/web    # Playwright
npm run build --workspace=apps/web
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_ORACULUM_GATEWAY_URL` | Base URL of the backend Gateway |
| `NEXT_PUBLIC_STELLAR_NETWORK` | `testnet` or `mainnet` |
| `NEXT_PUBLIC_USDC_CONTRACT_ID` | Stellar Asset Contract ID for USDC |
| `NEXT_PUBLIC_AGENT_REGISTRY_CONTRACT_ID` | Deployed `agent-registry` contract ID |

---

## Related Docs

[Root README](../../README.md) · [Backend](../../packages/gateway/README.md) · [Contracts](../../packages/contracts/README.md) · [SDK](../../packages/sdk/README.md)