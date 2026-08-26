#!/usr/bin/env bash
# ============================================================================
# build.sh — Build all contracts, report WASM sizes, enforce size budget, verify hashes
# ============================================================================
#
# This script:
#   1. Builds every workspace crate in release mode targeting WASM
#   2. Reports the byte size of each produced `.wasm` file
#   3. Compares each size against a configurable per-contract budget
#   4. Exits with a non-zero status if any contract exceeds its budget
#   5. Verifies WASM hashes against stored values for supply-chain security
#..
# Usage:
#   ./build.sh                  # default budget: 650 KB per contract
#   ./build.sh --budget 500000  # custom budget in bytes
#   ./build.sh --skip-hash-verify  # skip hash verification
#
# Requirements:
#   - `stellar contract build` (Soroban CLI) or `cargo build --target wasm32-unknown-unknown`
#   - `wasm-opt` is optional; if present, contracts are optimized before size check
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKSPACE_DIR="$CONTRACTS_DIR"
HASH_SCRIPT="${WORKSPACE_DIR}/scripts/generate-wasm-hash.sh"

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
DEFAULT_BUDGET=650000  # 650 KB in bytes
BUDGET="$DEFAULT_BUDGET"
WASM_DIR="$WORKSPACE_DIR/target/wasm32-unknown-unknown/release"
EXIT_CODE=0
SKIP_HASH_VERIFY=false

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case "$1" in
        --budget)
            BUDGET="$2"
            shift 2
            ;;
        --skip-hash-verify)
            SKIP_HASH_VERIFY=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [--budget <bytes>] [--skip-hash-verify]"
            echo ""
            echo "Build all Soroban contracts, report WASM sizes, enforce a size budget, and verify WASM hashes."
            echo ""
            echo "Options:"
            echo "  --budget <bytes>  Maximum allowed size per contract (default: $DEFAULT_BUDGET)"
            echo "  --skip-hash-verify  Skip WASM hash verification step"
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
fi

# ---------------------------------------------------------------------------
# Verify WASM hashes
# ---------------------------------------------------------------------------
if [[ "$SKIP_HASH_VERIFY" = false ]]; then
    echo "============================================================================"
    echo "  WASM Hash Verification"
    echo "============================================================================"
    echo ""

    if [[ ! -f "$HASH_SCRIPT" ]]; then
        echo "  WARNING: Hash verification script not found at $HASH_SCRIPT" >&2
        echo "  Skipping hash verification." >&2
        echo ""
    else
        # Check if hash file exists for verification
        HASH_FILE="${WORKSPACE_DIR}/scripts/wasm-hashes.json"
        if [[ ! -f "$HASH_FILE" ]]; then
            echo "  NOTE: No existing hash file found at $HASH_FILE" >&2
            echo "  Generating hashes for the first time..." >&2
            echo ""
            if "$HASH_SCRIPT"; then
                echo "  Hashes generated. Commit the hash file to enable future verification." >&2
                echo ""
            else
                echo "  WARNING: Hash generation failed" >&2
                echo "  Skipping hash verification." >&2
                echo ""
            fi
        else
            # Verify hashes against stored values
            echo "  Verifying hashes against stored values..."
            echo ""

            if "$HASH_SCRIPT" --verify; then
                echo "  ✅ All WASM hashes verified successfully."
                echo ""
            else
                echo "  ❌ HASH VERIFICATION FAILED" >&2
                echo "" >&2
                echo "  This indicates a potential supply-chain attack or dependency change." >&2
                echo "  Review the changes and update the stored hashes if expected:" >&2
                echo "    $HASH_SCRIPT" >&2
                echo "" >&2
                exit 1
            fi
        fi
    fi
else
    echo "  Skipping WASM hash verification (--skip-hash-verify flag provided)."
    echo ""
fi

echo "============================================================================"
echo "  BUILD COMPLETE"
echo "============================================================================"
echo ""
exit 0
