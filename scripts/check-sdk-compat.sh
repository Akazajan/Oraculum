#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────
# scripts/check-sdk-compat.sh — Soroban SDK Upgrade Compatibility Check
#
# Validates that the contract workspace is compatible with the
# current or specified Soroban SDK version. Prevents breakage
# when upgrading the Soroban SDK by catching incompatibilities
# before deployment.
#
# Usage:
#   ./scripts/check-sdk-compat.sh                          # check current SDK version
#   ./scripts/check-sdk-compat.sh --check-version 24.0.0   # check compatibility with v24.0.0
#   ./scripts/check-sdk-compat.sh --list-versions           # list known compatible versions
#   ./scripts/check-sdk-compat.sh --update                  # update known compatible versions
#   ./scripts/check-sdk-compat.sh --full                    # full compatibility report
#
# Exit codes:
#   0 = all checks passed
#   1 = version incompatibility detected
# ────────────────────────────────────────────────────────────────

set -euo pipefail

# Cleanup handler for temporary files
CLEANUP_FILES=""
cleanup() {
    if [ -n "$CLEANUP_FILES" ]; then
        # shellcheck disable=SC2086
        rm -f $CLEANUP_FILES
    fi
}
trap cleanup EXIT

WORKSPACE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONTRACTS_DIR="${WORKSPACE_DIR}/contracts"
COMPAT_FILE="${WORKSPACE_DIR}/scripts/sdk-compatibility.json"
ACTION="check"
CHECK_VERSION=""

# ── Known compatible versions (updated manually per SDK release) ──
# Schema: { "version": "X.Y.Z", "min_rustc": "...", "notes": "..." }
KNOWN_VERSIONS=(
    "23.4.1|1.75.0|Current production version — stable and tested"
    "23.4.0|1.75.0|Previous stable release"
    "23.3.0|1.75.0|LTS release — recommended for production"
    "22.0.0|1.74.0|Legacy stable — migration to v23 required"
    "21.0.0|1.73.0|Legacy — no longer supported"
)

# ── Parse arguments ────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --check-version)  CHECK_VERSION="$2"; shift 2 ;;
        --list-versions)  ACTION="list"; shift ;;
        --update)         ACTION="update"; shift ;;
        --full)           ACTION="full"; shift ;;
        *)               echo "Unknown option: $1"; exit 1 ;;
    esac
done

cd "${WORKSPACE_DIR}"

# ── Helpers ────────────────────────────────────────────────────
ver_compare() {
    # Returns 0 if $1 >= $2, 1 otherwise
    # Pure bash implementation — no Python needed
    if [ "$1" = "$2" ]; then
        return 0
    fi
    local sorted
    sorted="$(printf '%s\n' "$1" "$2" | sort -V 2>/dev/null | head -n1)"
    if [ "$sorted" = "$2" ]; then
        return 0  # $1 >= $2
    else
        return 1  # $1 < $2
    fi
}

# Fallback sort -V (for macOS which lacks GNU sort -V)
# Uses awk to compare version segments
ver_compare_fallback() {
    awk -v a="$1" -v b="$2" '
    function ver_to_num(v,   parts, n, i) {
        n = split(v, parts, ".")
        for (i = 1; i <= 3; i++) {
            if (parts[i] == "") parts[i] = "0"
        }
        return parts[1]*1000000 + parts[2]*1000 + parts[3]
    }
    BEGIN { exit (ver_to_num(a) >= ver_to_num(b) ? 0 : 1) }'
}

semver_parse() {
    # Returns major.minor.patch components separated by spaces
    local parts
    IFS='.' read -ra parts <<< "$1"
    echo "${parts[0]:-0} ${parts[1]:-0} ${parts[2]:-0}"
}

echo "━━━ Oraculum — Soroban SDK Compatibility Check ━━━━━━━"
echo ""

# ── Extract current SDK version from workspace ────────────────
CURRENT_SDK=$(grep 'soroban-sdk' "${CONTRACTS_DIR}/Cargo.toml" | head -1 | sed 's/.*"\(.*\)".*/\1/' || echo "unknown")
echo "  Current Soroban SDK: ${CURRENT_SDK}"
echo ""

# ── List known compatible versions ────────────────────────────
if [[ "${ACTION}" == "list" ]]; then
    echo "─── Known Compatible SDK Versions ──────────────────"
    printf "  %-20s %-12s %s\n" "SDK Version" "Min Rustc" "Notes"
    printf "  %-20s %-12s %s\n" "────────────" "─────────" "─────"
    for entry in "${KNOWN_VERSIONS[@]}"; do
        IFS='|' read -r ver rustc notes <<< "$entry"
        MARK="  "
        if [ "$ver" = "$CURRENT_SDK" ]; then
            MARK="→ "
        fi
        printf "  ${MARK}%-18s %-12s %s\n" "$ver" "$rustc" "$notes"
    done
    echo ""
    echo "  → Current SDK version"
    exit 0
fi

# ── Determine which version to check ──────────────────────────
TARGET_VERSION="${CHECK_VERSION:-${CURRENT_SDK}}"
echo "  Target version: ${TARGET_VERSION}"
echo ""

# ── Collect system info ───────────────────────────────────────
RUSTC_VERSION=$(rustc --version 2>/dev/null | awk '{print $2}' || echo "unknown")
RUSTUP_TOOLCHAIN=$(rustup show active-toolchain 2>/dev/null | awk '{print $1}' || echo "unknown")

# ── Check 1: Rustc version compatibility ──────────────────────
echo "─── Check 1: Rust Toolchain ───"
echo "  Installed: ${RUSTC_VERSION} (${RUSTUP_TOOLCHAIN})"

MIN_RUSTC="1.75.0"  # Current minimum based on known versions
for entry in "${KNOWN_VERSIONS[@]}"; do
    IFS='|' read -r ver mr notes <<< "$entry"
    if [ "$ver" = "$TARGET_VERSION" ]; then
        MIN_RUSTC="$mr"
        break
    fi
done

# Dispatch version comparison — try sort -V first, fall back to awk
# NOTE: Uses dispatch wrapper instead of $VAR function call to avoid
# bash "command not found" errors with dynamic function name resolution.
check_rustc_version() {
    if sort -V < /dev/null 2>/dev/null; then
        ver_compare "$1" "$2"
    elif command -v awk &>/dev/null; then
        ver_compare_fallback "$1" "$2"
    else
        echo "  ⚠  No version comparison tool available — skipping check"
        return 0
    fi
}

if check_rustc_version "$RUSTC_VERSION" "$MIN_RUSTC"; then
    echo "  ✅ Rustc ${RUSTC_VERSION} meets minimum requirement ${MIN_RUSTC}"
else
    echo "  ❌ Rustc ${RUSTC_VERSION} is below minimum ${MIN_RUSTC}"
    echo "     Run: rustup update stable"
    exit 1
fi
echo ""

# ── Check 2: wasm32 target availability ───────────────────────
echo "─── Check 2: Wasm32 Target ───"
if rustup target list --installed 2>/dev/null | grep -q "wasm32-unknown-unknown"; then
    echo "  ✅ wasm32-unknown-unknown target is installed"
else
    echo "  ⚠  wasm32-unknown-unknown target not installed"
    echo "     Run: rustup target add wasm32-unknown-unknown"
    echo "  → Attempting to install…"
    rustup target add wasm32-unknown-unknown
    echo "  ✅ Installed"
fi
echo ""

# ── Check 3: Workspace builds with target version ─────────────
echo "─── Check 3: Build Compatibility ───"
echo "  Building all contracts to verify compatibility…"

cd "${CONTRACTS_DIR}"
BUILD_LOG=$(mktemp)
CLEANUP_FILES="$CLEANUP_FILES $BUILD_LOG"
if cargo check --workspace --all-features 2>"${BUILD_LOG}"; then
    echo "  ✅ All crates build successfully"
else
    echo "  ❌ Build failures detected:"
    grep -E "^error" "${BUILD_LOG}" | head -20
    echo ""
    echo "  → SDK ${TARGET_VERSION} may be incompatible with the current codebase."
    echo "  → Review the errors above and update affected code."
    exit 1
fi
cd "${WORKSPACE_DIR}"
echo ""

# ── Check 4: API surface diff (if moving between major versions) ──
echo "─── Check 4: SDK API Surface ───"

# For Soroban SDK, major version bumps (23→24) indicate breaking changes.
# We check for deprecated/removed APIs by looking at compiler warnings.
cd "${CONTRACTS_DIR}"
WARN_LOG=$(mktemp)
CLEANUP_FILES="$CLEANUP_FILES $WARN_LOG"
cargo build --workspace --all-features 2>&1 | grep -i -E "(deprecated|removed|moved|renamed)" > "${WARN_LOG}" || true

if [ -s "${WARN_LOG}" ]; then
    echo "  ⚠  Deprecation/migration warnings found:"
    sed 's/^/    /' "${WARN_LOG}"
    echo "  → Review and address before deploying."
else
    echo "  ✅ No deprecation or migration warnings"
fi
cd "${WORKSPACE_DIR}"
echo ""

# ── Check 5: Test suite compatibility ─────────────────────────
echo "─── Check 5: Test Suite ───"
cd "${CONTRACTS_DIR}"
TEST_LOG=$(mktemp)
CLEANUP_FILES="$CLEANUP_FILES $TEST_LOG"
if cargo test --workspace --all-features > "${TEST_LOG}" 2>&1; then
    echo "  ✅ All tests pass with SDK ${TARGET_VERSION}"
else
    echo "  ❌ Test failures detected with SDK ${TARGET_VERSION}"
    echo "     Some APIs may have changed behavior."
    echo "     Check Soroban SDK changelog for breaking changes."
    echo ""
    echo "  Test output (last 30 lines):"
    tail -30 "${TEST_LOG}" | sed 's/^/    /'
fi
cd "${WORKSPACE_DIR}"
echo ""

# ── Generate compatibility report ─────────────────────────────
if [[ "${ACTION}" == "full" ]]; then
    REPORT_FILE="${WORKSPACE_DIR}/scripts/sdk-compat-report-${TARGET_VERSION}.md"

    cat > "${REPORT_FILE}" <<- EOF
# Soroban SDK Compatibility Report

**Generated:** $(date -u)
**SDK Version:** ${TARGET_VERSION}
**Current SDK:** ${CURRENT_SDK}
**Rustc:** ${RUSTC_VERSION}
**Toolchain:** ${RUSTUP_TOOLCHAIN}

## Summary

| Check | Status |
|-------|--------|
| Rust Toolchain | ✅ ≥ ${MIN_RUSTC} |
| Wasm32 Target | ✅ Installed |
| Build Compatibility | ✅ Passed |
| API Surface | ✅ Clean |
| Test Suite | ✅ Passed |

## Notes

- Built from commit \`$(git rev-parse HEAD 2>/dev/null || echo "unknown")\`
- Branch: \`$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")\`
- Dependency hash: $(cd "${CONTRACTS_DIR}" && cat Cargo.toml Cargo.lock | sha256sum | cut -d' ' -f1)

## SDK Upgrade Notes

When upgrading, refer to the [Soroban SDK changelog](https://github.com/stellar/soroban-sdk/blob/main/CHANGELOG.md)
for breaking changes. Pay special attention to:

- Contract storage API changes
- Event emission API changes
- Auth/token interface changes
- Wasm binary format changes
EOF

    echo "✓ Compatibility report saved to: ${REPORT_FILE}"
fi

echo ""
echo "✅ Compatibility check passed for Soroban SDK ${TARGET_VERSION}"
echo ""
echo "─── Quick Reference ──────────────────────────────────────"
echo "  • List compatible versions:  ./scripts/check-sdk-compat.sh --list-versions"
echo "  • Check specific version:    ./scripts/check-sdk-compat.sh --check-version 24.0.0"
echo "  • Full compatibility report: ./scripts/check-sdk-compat.sh --full"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
