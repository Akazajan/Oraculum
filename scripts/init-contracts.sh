#!/usr/bin/env bash
# ------------------------------------------------------------------
# init-contracts.sh
#
# Initialises every Oraculum contract with the required admin
# address, payment-token address, and other constructor parameters.
#
# Prerequisites:
#   - deploy-contracts.sh has been run and scripts/.contract-ids.env
#     exists (or the env vars below are set manually).
#   - Stellar CLI, funded deployer key.
#
# Usage:
#   export STELLAR_NETWORK=testnet
#   export ADMIN_ADDRESS=G…                   # admin public key
#   export PAYMENT_TOKEN_ID=CA…               # USDC SAC contract ID
#   export FEE_RECIPIENT=G…                   # (optional) treasury address
#   export FEE_BPS=250                        # (optional) 250 = 2.5 %
#   export DISPUTE_WINDOW_SECS=86400          # (optional) 24 h
#   source scripts/.contract-ids.env
#   ./scripts/init-contracts.sh
# ------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

NETWORK="${STELLAR_NETWORK:-testnet}"
DEPLOYER="${STELLAR_DEPLOYER_KEY:-deployer}"
ADMIN="${ADMIN_ADDRESS:?ADMIN_ADDRESS not set}"
PAYMENT_TOKEN="${PAYMENT_TOKEN_ID:?PAYMENT_TOKEN_ID not set}"

# Optional defaults
FEE_RECIPIENT="${FEE_RECIPIENT:-$ADMIN}"
FEE_BPS="${FEE_BPS:-250}"
DISPUTE_WINDOW_SECS="${DISPUTE_WINDOW_SECS:-86400}"

# ── Source contract IDs ──────────────────────────────────
if [[ -f "$SCRIPT_DIR/.contract-ids.env" ]]; then
  set -a
  source "$SCRIPT_DIR/.contract-ids.env"
  set +a
else
  echo "ERROR: .contract-ids.env not found – run deploy-contracts.sh first" >&2
  exit 1
fi

# ── Invocation helper ─────────────────────────────────────
invoke() {
  local contract_id_var="$1"; shift
  local method="$1"; shift
  local contract_id="${!contract_id_var}"

  if [[ -z "$contract_id" ]]; then
    echo "ERROR: $contract_id_var is empty – check .contract-ids.env" >&2
    exit 1
  fi

  echo "==> ${contract_id_var} :: ${method}"
  stellar contract invoke \
    --id "$contract_id" \
    --source "$DEPLOYER" \
    --network "$NETWORK" \
    -- \
    "$method" "$@"
}

# ── 1. access_control ──────────────────────────────────────
invoke ACCESS_CONTROL_ID initialize \
  --admin "$ADMIN"

# ── 2. membership_token ────────────────────────────────────
invoke MEMBERSHIP_TOKEN_ID set_admin \
  --admin "$ADMIN"

# ── 3. payment_escrow ──────────────────────────────────────
invoke PAYMENT_ESCROW_ID initialize \
  --admin "$ADMIN" \
  --payment_token "$PAYMENT_TOKEN" \
  --dispute_window_secs "$DISPUTE_WINDOW_SECS" \
  --fee_recipient "$FEE_RECIPIENT" \
  --fee_bps "$FEE_BPS"

# ── 4. resource_credits ────────────────────────────────────
invoke RESOURCE_CREDITS_ID initialize \
  --admin "$ADMIN" \
  --payment_token "$PAYMENT_TOKEN"

# ── 5. workspace_booking ───────────────────────────────────
invoke WORKSPACE_BOOKING_ID initialize \
  --admin "$ADMIN" \
  --payment_token "$PAYMENT_TOKEN"

# ── 6. manage_hub ──────────────────────────────────────────
# manage_hub has no public initialiser; it relies on lazy
# admin detection from storage.  No init call needed.

echo ""
echo "==> All initialised."
