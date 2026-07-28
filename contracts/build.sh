#!/usr/bin/env bash
# ============================================================================
# build.sh — Build all contracts, report WASM sizes, enforce size budget
# ============================================================================
#
# This script:
#   1. Builds every workspace crate in release mode targeting WASM
#   2. Reports the byte size of each produced `.wasm` file
#   3. Compares each size against a configurable per-contract budget
#   4. Exits with a non-zero status if any contract exceeds its budget
#
# Usage:
#   ./build.sh                  # default budget: 650 KB per contract
#   ./build.sh --budget 500000  # custom budget in bytes
#
# Requirements:
#   - `stellar contract build` (Soroban CLI) or `cargo build --target wasm32-unknown-unknown`
#   - `wasm-opt` is optional; if present, contracts are optimized before size check
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKSPACE_DIR="$CONTRACTS_DIR"

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
DEFAULT_BUDGET=650000  # 650 KB in bytes
BUDGET="$DEFAULT_BUDGET"
WASM_DIR="$WORKSPACE_DIR/target/wasm32-unknown-unknown/release"
EXIT_CODE=0

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case "$1" in
        --budget)
            BUDGET="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [--budget <bytes>]"
            echo ""
            echo "Build all Soroban contracts, report WASM sizes, and enforce a size budget."
            echo ""
            echo "Options:"
            echo "  --budget <bytes>  Maximum allowed size per contract (default: $DEFAULT_BUDGET)"
            exit 0
            ;;
        *)
            echo "Unknown argument: $1" >&2
            exit 1
            ;;
    esac
done

# ---------------------------------------------------------------------------
# Ensure wasm32 target is installed
# ---------------------------------------------------------------------------
if ! rustup target list --installed 2>/dev/null | grep -q wasm32-unknown-unknown; then
    echo ">>> Installing wasm32-unknown-unknown target..."
    rustup target add wasm32-unknown-unknown
fi

# ---------------------------------------------------------------------------
# Build all workspace members
# ---------------------------------------------------------------------------
echo "============================================================================"
echo "  Building Oraculum contracts (release, wasm32)"
echo "============================================================================"
echo ""
echo "  Workspace: $WORKSPACE_DIR"
echo "  Size budget per contract: $BUDGET bytes"
echo ""

cargo build \
    --release \
    --target wasm32-unknown-unknown \
    --manifest-path "$WORKSPACE_DIR/Cargo.toml" \
    2>&1

echo ""
echo "  Build completed successfully."
echo ""

# ---------------------------------------------------------------------------
# Optionally optimize with wasm-opt
# ---------------------------------------------------------------------------
if command -v wasm-opt &>/dev/null; then
    echo ">>> wasm-opt found — optimizing WASM files..."
    for wasm_file in "$WASM_DIR"/*.wasm; do
        if [[ -f "$wasm_file" ]]; then
            wasm-opt -Oz "$wasm_file" -o "$wasm_file" 2>/dev/null || true
        fi
    done
    echo "  Optimization complete."
    echo ""
else
    echo "  (wasm-opt not found — skipping optimization)"
    echo ""
fi

# ---------------------------------------------------------------------------
# Collect and report sizes
# ---------------------------------------------------------------------------
echo "============================================================================"
echo "  Contract WASM Sizes"
echo "============================================================================"
echo ""
printf "  %-45s %12s %10s\n" "CONTRACT" "SIZE (bytes)" "STATUS"
printf "  %-45s %12s %10s\n" "---------------------------------------------" "------------" "----------"

CONTRACT_COUNT=0
PASS_COUNT=0
FAIL_COUNT=0

if [[ ! -d "$WASM_DIR" ]]; then
    echo "  ERROR: WASM output directory not found at $WASM_DIR" >&2
    echo "  Make sure the build succeeded and the wasm32 target is installed." >&2
    exit 1
fi

for wasm_file in "$WASM_DIR"/*.wasm; do
    if [[ ! -f "$wasm_file" ]]; then
        continue
    fi

    filename="$(basename "$wasm_file")"

    # Normalize contract name: strip .wasm suffix, replace hyphens with underscores
    contract_name="${filename%.wasm}"

    file_size=$(stat -f%z "$wasm_file" 2>/dev/null || stat --format=%s "$wasm_file" 2>/dev/null || echo "0")
    CONTRACT_COUNT=$((CONTRACT_COUNT + 1))

    if [[ "$file_size" -le "$BUDGET" ]]; then
        status="PASS"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        status="FAIL"
        FAIL_COUNT=$((FAIL_COUNT + 1))
        EXIT_CODE=1
    fi

    printf "  %-45s %12s %10s\n" "$contract_name" "$file_size" "$status"
done

echo ""
echo "---------------------------------------------------------------------------"
echo "  Total contracts: $CONTRACT_COUNT  |  Pass: $PASS_COUNT  |  Fail: $FAIL_COUNT"
echo "  Budget: $BUDGET bytes per contract"
echo "---------------------------------------------------------------------------"
echo ""

if [[ "$EXIT_CODE" -ne 0 ]]; then
    echo "  BUILD FAILED: One or more contracts exceeded the size budget."
    echo "  Consider enabling additional optimization flags in Cargo.toml:"
    echo "    - opt-level = \"z\"    (minimize size)"
    echo "    - lto = true          (link-time optimization)"
    echo "    - codegen-units = 1   (single codegen unit for better optimization)"
    echo "    - panic = \"abort\"    (smaller binary, no unwinding)"
    echo "    - strip = \"symbols\"  (strip debug symbols)"
    exit 1
else
    echo "  ALL CONTRACTS PASS — within size budget."
    exit 0
fi
