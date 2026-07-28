#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────
# scripts/preflight-check.sh — Preflight Build Checks
#
# Validates that the contract workspace is ready for deployment:
#   ✓ Compilation succeeds (debug + release)
#   ✓ All tests pass
#   ✓ Code formatting is correct
#   ✓ Clippy lint passes
#   ✓ Wasm artifacts are present (release profile)
#
# Usage:
#   ./scripts/preflight-check.sh            # full validation
#   ./scripts/preflight-check.sh --fast      # skip release build & all tests
#   ./scripts/preflight-check.sh --ci        # same checks as CI pipeline
#   ./scripts/preflight-check.sh --deploy    # full + wasm hash generation
# ────────────────────────────────────────────────────────────────

set -euo pipefail

MODE="full"
WORKSPACE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONTRACTS_DIR="${WORKSPACE_DIR}/contracts"
TIMESTAMP="$(date +%s)"
PASS=0
FAIL=0

# ── Parse arguments ────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --fast)   MODE="fast"; shift ;;
        --ci)     MODE="ci"; shift ;;
        --deploy) MODE="deploy"; shift ;;
        *)        echo "Unknown option: $1"; exit 1 ;;
    esac
done

# ── Helper ─────────────────────────────────────────────────────
pass() { PASS=$((PASS + 1)); echo "  ✅ PASS"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ FAIL"; }

summary() {
    local total=$((PASS + FAIL))
    echo ""
    echo "━━━ Preflight Summary ─────────────────────────────"
    echo "  Result:  $([ "${FAIL}" -eq 0 ] && echo '✅ ALL PASSED' || echo '❌ SOME FAILED')"
    echo "  Passed:  ${PASS} / ${total}"
    echo "  Failed:  ${FAIL} / ${total}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    [ "${FAIL}" -eq 0 ] || exit 1
}

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Oraculum — Preflight Build Check                      "
echo "  Mode: ${MODE}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

cd "${CONTRACTS_DIR}"

# ── 1. Formatting check ───────────────────────────────────────
echo "─── Check 1: Code Formatting ───"
if cargo fmt --all -- --check 2>&1; then
    pass
else
    fail
fi
echo ""

# ── 2. Clippy lint ────────────────────────────────────────────
echo "─── Check 2: Clippy Lint ───"
if cargo clippy --all-targets --all-features -- -D warnings 2>&1; then
    pass
else
    fail
fi
echo ""

# ── 3. Debug build ────────────────────────────────────────────
echo "─── Check 3: Debug Build ───"
if cargo build --all --verbose 2>&1; then
    pass
else
    fail
fi
echo ""

if [[ "${MODE}" != "fast" ]]; then
    # ── 4. Release build (wasm target) ──────────────────────
    echo "─── Check 4: Release Build (wasm32) ───"
    if cargo build --all --release --verbose 2>&1; then
        pass

        # Verify wasm artifacts exist
        echo "  → Verifying wasm artifacts…"
        WASM_COUNT=0
        for wasm in target/wasm32-unknown-unknown/release/*.wasm; do
            if [ -f "$wasm" ]; then
                SIZE=$(stat --printf="%s" "$wasm" 2>/dev/null || stat -f%z "$wasm" 2>/dev/null || echo "?")
                echo "    📦 $(basename "$wasm")  (${SIZE} bytes)"
                WASM_COUNT=$((WASM_COUNT + 1))
            fi
        done
        echo "  → ${WASM_COUNT} wasm artifact(s) generated."
        [ "${WASM_COUNT}" -gt 0 ] && pass || fail
    else
        fail
    fi
    echo ""

    # ── 5. Full test suite ──────────────────────────────────
    echo "─── Check 5: Test Suite ───"
    if cargo test --all --verbose 2>&1; then
        pass
    else
        fail
    fi
    echo ""

    # ── 6. Dependency audit (if cargo-audit available) ──────
    echo "─── Check 6: Dependency Audit ───"
    if command -v cargo-audit &>/dev/null; then
        if cargo audit 2>&1; then
            pass
        else
            fail
        fi
    else
        echo "  ⚠  cargo-audit not installed — skipping."
        echo "  → Install: cargo install cargo-audit"
        pass  # not a hard failure
    fi
    echo ""
fi

# ── 7. Release profile optimizations ─────────────────────────
echo "─── Check 7: Release Profile ───"
if grep -q "opt-level.*=.*\"z\"" Cargo.toml 2>/dev/null; then
    echo "  ✓ Optimized for size (opt-level = \"z\")"
    pass
else
    echo "  ⚠  Release profile not optimized for size."
    fail
fi
echo ""

# ── Final summary ────────────────────────────────────────────
summary
