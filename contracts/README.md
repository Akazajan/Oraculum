# Oraculum — Smart Contracts

> The on-chain core: agent registration, x402-style pay-per-query settlement, remix revenue-sharing, and verifiable query receipts — built on Stellar's Soroban platform.

[![Soroban](https://img.shields.io/badge/Platform-Soroban-7D00FF?style=flat-square)](https://soroban.stellar.org)
[![Rust](https://img.shields.io/badge/Rust-1.75+-orange?style=flat-square&logo=rust)]()

Covers `contracts/`. See [Root README](../README.md) · [Backend](../backend/README.md) · [Frontend](../frontend/README.md)..

---

## Overview

| Contract | Purpose |
|---|---|
| `access_control` | Role-based access: admin, user/agent roles, multi-sig proposals, governance |
| `workspace_booking` | Bookable resources (hot desks, offices, meeting rooms) with availability |
| `payment_escrow` | Dispute-aware escrow: deposits, releases, refunds, 402-style settlement |
| `resource_credits` | Off-chain credit accounting (deprecated — kept for migration) |
| `membership_token` | Simple membership NFT with issuance and transfer |
| `manage_hub` | Hub orchestration: membership tokens, staking tiers, subscription plans, fractionalization, royalty, allowances, upgrades, batch ops |

All written in Rust via the Soroban SDK, settling in **USDC** through Stellar's native Stellar Asset Contract (SAC)..

```,
contracts/
├── access_control/src/
├── common_types/src/
├── manage_hub/src/          # multi-module: membership_token, staking, subscription,
│                            #   fractionalization, allowance, royalty, upgrade, batch
├── membership_token/src/
├── payment_escrow/src/
├── resource_credits/src/
└── workspace_booking/src/
```

---

## Build, Test, Deploy

```bash
# Prereqs: Rust 1.75+ (wasm32-unknown-unknown target), Stellar CLI, funded testnet account
rustup target add wasm32-unknown-unknown
stellar keys generate deployer --network testnet && stellar keys fund deployer --network testnet

cd contracts
stellar contract build
cargo test
```

Each deploy returns a contract ID. Convenience scripts are provided:

- `scripts/deploy-contracts.sh` — builds and deploys all contracts, saves IDs to `.contract-ids.env`
- `scripts/init-contracts.sh` — initialises each contract with admin, payment token, and fees

Usage:

```bash
export STELLAR_NETWORK=testnet
export ADMIN_ADDRESS=G...
export PAYMENT_TOKEN_ID=CA...

./scripts/deploy-contracts.sh
source scripts/.contract-ids.env
./scripts/init-contracts.sh
```

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

All contracts emit events through `env.events().publish(...)`. The tables below document every emitted event topic and data payload.

### `access_control`

| Event | Topics | Data |
|---|---|---|
| `init` | `(Symbol("init"), admin)` | `(admins, config)` |
| `role_set` | `(Symbol("role_set"), user, role)` | `(caller, old_role)` |
| `role_rm` | `(Symbol("role_rm"), user)` | `(caller, old_role)` |
| `acc_deny` | `(Symbol("acc_deny"), user, required_role)` | `"blacklisted"` |
| `acc_try` | `(Symbol("acc_try"), user, required_role)` | `(success, current_attempts + 1)` |
| `cfg_upd` | `(Symbol("cfg_upd"), config)` | `(caller, old_config)` |
| `adm_prop` | `(Symbol("adm_prop"), new_admin)` | `current_admin` |
| `adm_xfer` | `(Symbol("adm_xfer"), new_admin)` | `old_admin` |
| `adm_canc` | `(Symbol("adm_canc"), proposed_admin)` | `current_admin` |
| `paused` | `(Symbol("paused"), true)` | `proposer` |
| `unpaused` | `(Symbol("unpaused"), false)` | `proposer` |
| `proposal` | `(Symbol("proposal"), proposal_id, proposal_type)` | `proposer` |
| `executed` | `(Symbol("executed"), proposal_id)` | `proposer` |
| `ms_upd` | `(Symbol("ms_upd"), new_config)` | `proposer` |
| `emrg_pse` | `(Symbol("emrg_pse"), reason)` | `proposer` |
| `batch_bl` | `(Symbol("batch_bl"), users.len())` | `proposer` |
| `add_adm` | `(Symbol("add_adm"), new_admin)` | `proposer` |
| `rm_adm` | `(Symbol("rm_adm"), admin_to_remove)` | `proposer` |
| `tier_set` | `(Symbol("tier_set"), user, tier_level)` | `(caller, old_tier)` |
| `tier_req` | `(Symbol("tier_req"), role, required_tier)` | `caller` |
| `tier_chk` | `(Symbol("tier_chk"), user, required_tier)` | `has_access` |

### `workspace_booking`

| Event | Topics | Data |
|---|---|---|
| `init` | `(Symbol("init"))` | `(admin, payment_token)` |
| `ws_reg` | `(Symbol("ws_reg"), id)` | `(name, workspace_type, capacity, hourly_rate)` |
| `ws_avail` | `(Symbol("ws_avail"), workspace_id)` | `(is_available)` |
| `booked` | `(Symbol("booked"), booking_id)` | `(member, workspace_id, start_time, end_time, amount)` |
| `cancel` | `(Symbol("cancel"), booking_id)` | `(caller, amount_paid)` |
| `complete` | `(Symbol("complete"), booking_id)` | `(workspace_id, member)` |

### `payment_escrow`

| Event | Topics | Data |
|---|---|---|
| `init` | `(Symbol("init"))` | `(admin, payment_token, dispute_window_secs, fee_recipient, fee_bps)` |
| `dw_set` | `(Symbol("dw_set"))` | `(window_secs)` |
| `feer_set` | `(Symbol("feer_set"))` | `(recipient)` |
| `fbps_set` | `(Symbol("fbps_set"))` | `(fee_bps)` |
| `created` | `(Symbol("created"), escrow_id)` | `(depositor, beneficiary, amount, release_after)` |
| `released` | `(Symbol("released"), escrow_id)` | `(beneficiary, beneficiary_amount, fee_recipient, fee_amount)` |
| `refunded` | `(Symbol("refunded"), escrow_id)` | `(depositor, amount)` |
| `disputed` | `(Symbol("disputed"), escrow_id)` | `(depositor, now)` |
| `resolved` | `(Symbol("resolved"), escrow_id)` | `(winner, amount, release_to_beneficiary)` |
| `claimed` | `(Symbol("claimed"), escrow_id)` | `(beneficiary, beneficiary_amount, fee_recipient, fee_amount)` |

### `manage_hub` — membership / batch

| Event | Topics | Data |
|---|---|---|
| `token_iss` | `(Symbol("token_iss"), id, user)` | `(admin, current_time, expiry_date, MembershipStatus::Active)` |
| `token_xfr` | `(Symbol("token_xfr"), id, new_user)` | `(old_user, timestamp)` |
| `tok_sale` | `(Symbol("tok_sale"), id, new_user)` | `(sale_price, timestamp)` |
| `token_dlg` | `(Symbol("token_dlg"), id, spender)` | `(old_user, to, allowance_amount, timestamp)` |
| `admin_set` | `(Symbol("admin_set"), admin)` | `timestamp` |
| `meta_set` | `(Symbol("meta_set"), id, version)` | `(caller, current_time)` |
| `meta_upd` | `(Symbol("meta_upd"), id, metadata.version)` | `(updated_by, last_updated)` |
| `meta_rmv` | `(Symbol("meta_rmv"), id, metadata.version)` | `(updated_by, last_updated)` |
| `rnw_cfg` | `(Symbol("rnw_cfg"), admin)` | `(grace_period_duration, auto_renewal_notice_days, renewals_enabled)` |
| `token_rnw` | `(Symbol("token_rnw"), id, user)` | `(payment_token, amount, old_expiry, new_expiry)` |
| `grace_in` | `(Symbol("grace_in"), id, user)` | `(current_time, grace_period_expires_at)` |
| `auto_rnw` | `(Symbol("auto_rnw"), id, user)` | `(enabled, payment_token)` |
| `auto_ok` | `(Symbol("auto_ok"), id, user)` | `(payment_token, amount, old_expiry, new_expiry)` |
| `emg_pause` | `(Symbol("emg_pause"), admin)` | `(current_time, reason, auto_unpause_at, time_lock_until)` |
| `emg_unp` | `(Symbol("emg_unp"), admin)` | `(timestamp)` |
| `tok_pause` | `(Symbol("tok_pause"), id, admin)` | `(current_time, reason)` |
| `tok_unp` | `(Symbol("tok_unp"), id, admin)` | `(timestamp)` |
| `grace_ar` | `(Symbol("grace_ar"), id, user)` | `(current_time, grace_period_expires_at, "auto_renewal_failed")` |
| `bat_mint` | `(Symbol("bat_mint"))` | `(params_vec.len(), timestamp)` |
| `bat_xfr` | `(Symbol("bat_xfr"))` | `(params_vec.len(), timestamp)` |
| `bat_upd` | `(Symbol("bat_upd"))` | `(params_vec.len(), timestamp)` |

### `manage_hub` — staking

| Event | Topics | Data |
|---|---|---|
| `StakingTierCreated` | `(Symbol("StakingTierCreated"), tier.id)` | `timestamp` |
| `StakingTierDeactivated` | `(Symbol("StakingTierDeactivated"), tier_id)` | `now` |
| `StakingTierReactivated` | `(Symbol("StakingTierReactivated"), tier_id)` | `now` |
| `Staked` | `(Symbol("Staked"), staker, tier_id)` | `(amount, unlock_at)` |
| `Unstaked` | `(Symbol("Unstaked"), staker)` | `(stake.amount, rewards)` |
| `EmergencyUnstaked` | `(Symbol("EmergencyUnstaked"), staker)` | `(amount_returned, penalty)` |

### `manage_hub` — subscription

| Event | Topics | Data |
|---|---|---|
| `sub_creat` | `(Symbol("sub_creat"), id, user)` | `(payment_token, amount, current_time, expires_at)` |
| `subscr` | `(Symbol("subscr"), id, user)` | `PauseHistoryEntry` |
| `sub_revok` | `(Symbol("sub_revok"), id, user)` | `(timestamp, old_status, MembershipStatus::Revoked)` |
| `sub_inval` | `(Symbol("sub_inval"), id, user)` | `(timestamp, old_status, MembershipStatus::Invalid)` |
| `sub_cancl` | `(Symbol("sub_cancl"), id, user)` | `(timestamp, old_status, MembershipStatus::Inactive)` |
| `sub_renew` | `(Symbol("sub_renew"), id, user)` | `(payment_token, amount, old_expiry, expires_at)` |
| `tier_cr` | `(Symbol("tier_cr"), tier.id)` | `(tier, admin)` |
| `tier_dea` | `(Symbol("tier_dea"), id, admin)` | `(now)` |
| `tier_rea` | `(Symbol("tier_rea"), id, admin)` | `(now)` |
| `tier_upd` | `(Symbol("tier_upd"), tier.id)` | `(tier, admin)` |
| `sub_tier` | `(Symbol("sub_tier"), subscription_id)` | `(user, tier_id, billing_cycle, amount)` |
| `promo_cr` | `(Symbol("promo_cr"), promo_code)` | `(promotion, admin)` |
| `tier_chg` | `(Symbol("tier_chg"), request_id)` | `(user, from_tier_id, to_tier_id)` |
| `usdc_set` | `(Symbol("usdc_set"), usdc_address)` | `(admin, timestamp)` |

### `manage_hub` — fractionalization

| Event | Topics | Data |
|---|---|---|
| `Fractionalized` | `(String("Fractionalized"), token_id, user)` | `(total_shares, min_fraction_size, timestamp)` |
| `FractionTransferred` | `(String("FractionTransferred"), token_id, from)` | `(to, share_amount, timestamp)` |
| `Recombined` | `(String("Recombined"), token_id, holder)` | `timestamp` |
| `DividendDistributed` | `(String("DividendDistributed"), token_id, admin)` | `(total_amount, recipients, distributed_at)` |

### `manage_hub` — allowance & royalty & upgrade

| Event | Topics | Data |
|---|---|---|
| `Approval` | `(String("Approval"), token_id, owner, spender)` | `(amount, expires_at, updated_at)` |
| `AllowanceRevoked` | `(String("AllowanceRevoked"), token_id, owner, spender)` | `timestamp` |
| `AllowanceUsed` | `(String("AllowanceUsed"), token_id, owner, spender)` | `(amount, allowance.amount, updated_at)` |
| `roy_set` | `(Symbol("roy_set"), token_id)` | `(recipients.len(), timestamp)` |
| `roy_paid` | `(Symbol("roy_paid"), token_id, recipient)` | `(payment_token, amount, timestamp)` |
| `TokenUpgraded` | `(String("TokenUpgraded"), token_id, caller)` | `(from_version, to_version)` |

---

## Security Considerations

- **Auth:** every mutating function requires `require_auth()` via Soroban's native framework
- **Escrow expiry:** payment escrows enforce release-after timestamps and dispute windows to prevent stale or malicious claims
- **Audits:** contracts are unaudited pre-Wave submission; a formal audit is planned before mainnet value limits are raised

```bash
cargo test                                                    # unit tests
stellar network start local && cargo test --features integration-tests
```

---

## Related Docs

[Root README](../README.md) · [Backend](../backend/README.md) · [Frontend](../frontend/README.md)