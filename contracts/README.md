# Oraculum — Smart Contracts

> The on-chain core: agent registration, x402-style pay-per-query settlement, remix revenue-sharing, and verifiable query receipts — built on Stellar's Soroban platform.

[![Soroban](https://img.shields.io/badge/Platform-Soroban-7D00FF?style=flat-square)](https://soroban.stellar.org)
[![Rust](https://img.shields.io/badge/Rust-1.75+-orange?style=flat-square&logo=rust)]()

Covers `packages/contracts`. See [Root README](../../README.md) · [Backend](../gateway/README.md) · [Frontend](../../apps/web/README.md).

---

## Overview

| Contract | Purpose |
|---|---|
| `agent-registry` | On-chain directory: agent metadata, pricing, ownership, remix lineage |
| `x402-soroban` | Pay-per-query settlement — on-chain HTTP-402-style flow |
| `revenue-stream` | Continuous USDC revenue sharing from remixed agents to original creators |
| `query-receipt` | Verifiable, on-chain proof a query was paid for and fulfilled |

All written in Rust via the Soroban SDK, settling in **USDC** through Stellar's native Stellar Asset Contract (SAC) — no custom token, no XLM required from end users.

```
packages/contracts/
├── agent-registry/src/{lib,types,storage}.rs
├── x402-soroban/src/{lib,types,usdc}.rs
├── revenue-stream/src/{lib,stream}.rs
├── query-receipt/src/{lib,receipt}.rs
└── shared/src/{errors,auth}.rs
```

---

## Build, Test, Deploy

```bash
# Prereqs: Rust 1.75+ (wasm32-unknown-unknown target), Stellar CLI, funded testnet account
rustup target add wasm32-unknown-unknown
stellar keys generate deployer --network testnet && stellar keys fund deployer --network testnet

cd packages/contracts
stellar contract build
cargo test

stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/agent_registry.wasm \
  --source deployer --network testnet
# Repeat for x402_soroban.wasm, revenue_stream.wasm, query_receipt.wasm
```

Each deploy returns a contract ID — record in the Gateway and Frontend `.env` files. A convenience script wraps all four: `../../scripts/deploy-contracts.sh`.

---

## `agent-registry`

```rust
pub struct AgentMetadata {
    pub name: Symbol,
    pub owner: Address,
    pub category: Category,           // OnChainIntelligence, LifeConsulting, ...
    pub free_tier_enabled: bool,
    pub paid_tier_price: i128,        // USDC stroops, 7 decimals
    pub parent_agent_id: Option<u64>, // Set if this is a remix/fork
}

pub trait AgentRegistryTrait {
    fn register_agent(env: Env, owner: Address, metadata: AgentMetadata, parent: Option<u64>) -> u64;
    fn get_agent(env: Env, agent_id: u64) -> AgentMetadata;
    fn update_pricing(env: Env, agent_id: u64, owner: Address, new_price: i128);
    fn list_agents(env: Env, category: Option<Category>) -> Vec<u64>;
    fn get_lineage(env: Env, agent_id: u64) -> Vec<u64>; // walks parent chain for remixes
}
```

`paid_tier_price: 5000000` = $0.50 USDC (`0.50 * 10^7`).

---

## `x402-soroban`

```rust
pub struct PaymentRequest { pub id: BytesN<32>, pub agent_id: u64, pub payer: Address, pub amount: i128, pub expires_at: u64 }
pub struct QueryReceipt { pub id: BytesN<32>, pub agent_id: u64, pub payer: Address, pub amount_paid: i128, pub settled_at: u64 }

pub trait X402Trait {
    fn request_payment(env: Env, agent_id: u64, payer: Address, amount: i128) -> PaymentRequest;
    fn settle_payment(env: Env, request_id: BytesN<32>, payer: Address) -> QueryReceipt;
    fn verify_receipt(env: Env, receipt: QueryReceipt) -> bool;
}
```

**Flow:** Gateway creates a `PaymentRequest` (5-min expiry) → payer's wallet signs `settle_payment` → contract calls the USDC SAC's `transfer()` (payer → agent owner, minus protocol fee) → mints a `QueryReceipt` → Gateway calls `verify_receipt()`.

A configurable protocol fee (default **250 bps / 2.5%**) routes to the treasury on each settlement, set via `set_protocol_fee(admin, new_fee_bps)`.

---

## `revenue-stream`

The on-chain backbone of Oraculum's remix economy — when an agent is registered with a `parent_agent_id`, a share of its earnings streams back to the original creator.

```rust
pub trait RevenueStreamTrait {
    fn open_stream(env: Env, agent_id: u64, recipient: Address, share_bps: u32); // e.g. 1500 = 15%
    fn distribute(env: Env, agent_id: u64, total_amount: i128);
    fn claim(env: Env, recipient: Address) -> i128;
    fn pending_balance(env: Env, recipient: Address) -> i128;
}
```

**Example:** a $0.50 query to a remix with `share_bps: 1500` splits as: 2.5% protocol fee → treasury, 15% of the remainder → parent creator, rest → remix creator. Chained remixes (forks of forks) distribute proportionally via `get_lineage()`.

---

## `query-receipt`

```rust
pub trait QueryReceiptTrait {
    fn issue_receipt(env: Env, agent_id: u64, payer: Address, query_hash: BytesN<32>) -> u64;
    fn get_receipt(env: Env, receipt_id: u64) -> Receipt;
    fn list_receipts_for_payer(env: Env, payer: Address) -> Vec<u64>;
}
```

An append-only, publicly verifiable log of every paid query, independent of the Gateway's database. `query_hash` is a SHA-256 of the canonicalized payload — proves a query was paid for without exposing potentially sensitive content on-chain.

---

## Fee Abstraction Note

End users never need XLM. These contracts handle USDC-denominated payment logic only — actual gas sponsorship uses **Stellar Fee Bump Transactions** at the Gateway layer (user signs the inner transaction; the Gateway's sponsoring account wraps and pays the network fee). See [Backend README](../gateway/README.md).

---

## Governance Note

Current phase: a single admin `Address` controls protocol parameters (fee bps, upgrades) via `initialize` / `transfer_admin`. Full DAO governance is planned for Phase 4 — see [root README](../../README.md#roadmap).

---

## Events

| Contract | Event | Payload |
|---|---|---|
| `agent-registry` | `agent_registered` | `agent_id, owner, parent_agent_id` |
| `x402-soroban` | `payment_settled` | `request_id, agent_id, payer, amount` |
| `revenue-stream` | `revenue_claimed` | `recipient, amount` |
| `query-receipt` | `receipt_issued` | `receipt_id, agent_id, payer, query_hash` |

---

## Security Considerations

- **Auth:** every mutating function requires `require_auth()` via Soroban's native framework
- **Expiry:** `PaymentRequest`s expire after 5 minutes to prevent stale/replayed flows
- **Receipt uniqueness:** single-use, tied to a specific `query_hash`; replays rejected even within cache window
- **Audits:** contracts are unaudited pre-Wave submission; a formal audit is planned before mainnet value limits are raised

```bash
cargo test                                                    # unit tests
stellar network start local && cargo test --features integration-tests
```

---

## Related Docs

[Root README](../../README.md) · [Backend](../gateway/README.md) · [Frontend](../../apps/web/README.md)