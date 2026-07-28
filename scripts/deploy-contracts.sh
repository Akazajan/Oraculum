#!/usr/bin/env bash
# ------------------------------------------------------------------
# deploy-contracts.sh
#
# Builds and deploys all Oraculum Soroban contracts to the chosen
# network.  Records every contract ID in .env format at
#   scripts/.contract-ids.env
#
# Prerequisites:
#   - Rust 1.75+ with wasm32-unknown-unknown target
#   - Stellar CLI (stellar) v0.40+
#   - Funded Stellar account – key stored as "deployer"
#
# Usage:
#   export STELLAR_NETWORK=testnet          # or "local" / "futurenet"
#   ./scripts/deploy-contracts.sh
# ------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

NETWORK="${STELLAR_NETWORK:-testnet}"
DEPLOYER="${STELLAR_DEPLOYER_KEY:-deployer}"
IDS_FILE="${SCRIPT_DIR}/.contract-ids.env"

# ── Clean slate ────────────────────────────────────────────
rm -f "$IDS_FILE"

# ── Build all contracts ────────────────────────────────────
echo "==> Building contracts (release)…"
cd "$REPO_ROOT/contracts"
stellar contract build

# ── Deploy helper ──────────────────────────────────────────
deploy() {
  local pkg_name="$1"
  local wasm_path="$REPO_ROOT/contracts/target/wasm32-unknown-unknown/release/${pkg_name}.wasm"

  if [[ ! -f "$wasm_path" ]]; then
    echo "ERROR: wasm not found at $wasm_path" >&2
    exit 1
  fi

  echo "==> Deploying ${pkg_name}…"
  local contract_id
  contract_id=$(stellar contract deploy \
    --wasm "$wasm_path" \
    --source "$DEPLOYER" \
    --network "$NETWORK")

  echo "${pkg_name^^}_ID=${contract_id}" >> "$IDS_FILE"
  echo "    ${pkg_name}: ${contract_id}"
}

# ── Deploy each contract ──────────────────────────────────
deploy access_control
deploy workspace_booking
deploy payment_escrow
deploy resource_credits
deploy membership_token
deploy manage_hub

echo ""
echo "==> All contracts deployed.  IDs saved to ${IDS_FILE}"
echo "==> Next step:  source ${IDS_FILE} && ./scripts/init-contracts.sh"
