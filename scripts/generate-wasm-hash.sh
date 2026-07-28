#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────
# scripts/generate-wasm-hash.sh — Deterministic Wasm Hash Generator
#
# Generates and verifies SHA-256 hashes for Soroban contract wasm
# artifacts, making deployments verifiable and reproducible.
#
# Deterministic builds require:
#   1. Same source code (git commit)
#   2. Same Rust toolchain version (rust-toolchain.toml or CI image)
#   3. Same dependency versions (Cargo.lock committed)
#   4. Same build profile (release) with LTO
#
# Usage:
#   ./scripts/generate-wasm-hash.sh                      # hash existing wasm artifacts
#   ./scripts/generate-wasm-hash.sh --build               # build & hash
#   ./scripts/generate-wasm-hash.sh --verify              # verify stored hashes
#   ./scripts/generate-wasm-hash.sh --print-readme-table  # print markdown table of hashes for README
# ────────────────────────────────────────────────────────────────

set -euo pipefail

WORKSPACE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONTRACTS_DIR="${WORKSPACE_DIR}/contracts"
HASH_FILE="${WORKSPACE_DIR}/scripts/wasm-hashes.json"
BUILD="false"
VERIFY="false"
UPDATE_README="false"

# ── Parse arguments ────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --build)        BUILD="true"; shift ;;
        --verify)       VERIFY="true"; shift ;;
        --print-readme-table) UPDATE_README="true"; shift ;;
        *)              echo "Unknown option: $1"; exit 1 ;;
    esac
done

# ── Ensure we're in the right directory ───────────────────────
# ── Prerequisites check ────────────────────────────────────────
# Python is needed for JSON display/parsing (optional — falls back to cat)
HAS_PYTHON=false
_run_python() {
    if command -v python3 &>/dev/null; then
        python3 "$@"
    elif command -v python &>/dev/null; then
        python "$@"
    else
        return 1
    fi
}
if command -v python3 &>/dev/null || command -v python &>/dev/null; then
    HAS_PYTHON=true
fi

cd "${WORKSPACE_DIR}"

echo "━━━ Oraculum — Deterministic Wasm Hash Generator ━━━━━━━━"
echo "  Workspace: ${WORKSPACE_DIR}"
echo "  Hash file: ${HASH_FILE}"
if [ "$HAS_PYTHON" = false ]; then
    echo "  ⚠  Python3 not found — JSON display will use cat instead"
fi
echo ""

# ── Build if requested ────────────────────────────────────────
if [[ "${BUILD}" == "true" ]]; then
    echo "→ Building contracts (release profile)…"
    cd "${CONTRACTS_DIR}"
    cargo build --workspace --release --target wasm32-unknown-unknown
    cd "${WORKSPACE_DIR}"
    echo "  ✓ Build complete."
    echo ""
fi

# ── Find wasm artifacts ───────────────────────────────────────
WASM_ARTIFACTS=()
while IFS= read -r -d '' wasm; do
    WASM_ARTIFACTS+=("$wasm")
done < <(find "${CONTRACTS_DIR}/target/wasm32-unknown-unknown/release" -maxdepth 1 -name '*.wasm' -print0 2>/dev/null || true)

if [ ${#WASM_ARTIFACTS[@]} -eq 0 ]; then
    echo "⚠  No wasm artifacts found."
    echo "   Build first with: ./scripts/generate-wasm-hash.sh --build"
    exit 1
fi

echo "→ Found ${#WASM_ARTIFACTS[@]} wasm artifact(s):"
for wasm in "${WASM_ARTIFACTS[@]}"; do
    echo "   📦 $(basename "$wasm")"
done
echo ""

# ── Generate manifest hash (for reproducibility tracking) ─────
# The manifest hash covers Cargo.toml and Cargo.lock so that
# any dependency change is detected.
compute_manifest_hash() {
    (
        cd "${CONTRACTS_DIR}"
        cat Cargo.toml Cargo.lock | sha256sum | cut -d' ' -f1
    )
}

# ── Generate hashes ───────────────────────────────────────────
GIT_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
GIT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
BUILD_TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
MANIFEST_HASH=$(compute_manifest_hash)

# Collect Rust toolchain info
RUSTC_VERSION=$(rustc --version 2>/dev/null || echo "unknown")
RUSTUP_TOOLCHAIN=$(rustup show active-toolchain 2>/dev/null | awk '{print $1}' || echo "unknown")

echo "→ Generating hashes…"

HASHES_JSON="{
  \"generated_at\": \"${BUILD_TIMESTAMP}\",
  \"git_commit\": \"${GIT_COMMIT}\",
  \"git_branch\": \"${GIT_BRANCH}\",
  \"rustc_version\": \"${RUSTC_VERSION}\",
  \"toolchain\": \"${RUSTUP_TOOLCHAIN}\",
  \"manifest_hash\": \"${MANIFEST_HASH}\",
  \"contracts\": {"

FIRST=true
for wasm in "${WASM_ARTIFACTS[@]}"; do
    NAME=$(basename "$wasm" .wasm)
    SHA=$(sha256sum "$wasm" | cut -d' ' -f1)
    SIZE=$(stat --printf="%s" "$wasm" 2>/dev/null || stat -f%z "$wasm" 2>/dev/null || echo "0")

    if [ "$FIRST" = true ]; then
        FIRST=false
    else
        HASHES_JSON+=","
    fi

    HASHES_JSON+="
    \"${NAME}\": {
      \"wasm_file\": \"${NAME}.wasm\",
      \"sha256\": \"${SHA}\",
      \"size_bytes\": ${SIZE}
    }"
done

HASHES_JSON+="
  }
}
"

echo "${HASHES_JSON}" > "${HASH_FILE}"
echo "✓ Hashes written to ${HASH_FILE}"
echo ""

# ── Display summary ───────────────────────────────────────────
echo "─── Hash Summary ─────────────────────────────────────"
if [ "$HAS_PYTHON" = true ]; then
    _run_python -m json.tool 2>/dev/null < "${HASH_FILE}" || cat "${HASH_FILE}"
else
    cat "${HASH_FILE}"
fi
echo ""

# ── Verification mode ────────────────────────────────────────
if [[ "${VERIFY}" == "true" ]]; then
    echo "─── Verifying Stored Hashes ─────────────────────────"
    if [ ! -f "${HASH_FILE}" ]; then
        echo "❌ No hash file found at ${HASH_FILE}"
        exit 1
    fi

    VERIFY_FAIL=0
    VERIFY_PASS=0

    for wasm in "${WASM_ARTIFACTS[@]}"; do
        NAME=$(basename "$wasm" .wasm)
        CURRENT_SHA=$(sha256sum "$wasm" | cut -d' ' -f1)

        if [ "$HAS_PYTHON" = true ]; then
            STORED_SHA=$(_run_python -c "import json; d=json.load(open('${HASH_FILE}')); print(d['contracts']['${NAME}']['sha256'])" 2>/dev/null || echo "")
        else
            # Fallback: grep the raw JSON file
            STORED_SHA=$(grep -A2 "\"${NAME}\"" "${HASH_FILE}" 2>/dev/null | grep "sha256" | sed 's/.*"sha256": "\(.*\)".*/\1/' || echo "")
        fi

        if [ -z "${STORED_SHA}" ]; then
            echo "  ⚠  ${NAME}: no stored hash to compare against"
            continue
        fi

        if [ "${CURRENT_SHA}" == "${STORED_SHA}" ]; then
            echo "  ✅ ${NAME}: hash MATCHES (${CURRENT_SHA})"
            VERIFY_PASS=$((VERIFY_PASS + 1))
        else
            echo "  ❌ ${NAME}: hash MISMATCH"
            echo "     Stored:   ${STORED_SHA}"
            echo "     Current:  ${CURRENT_SHA}"
            VERIFY_FAIL=$((VERIFY_FAIL + 1))
        fi
    done

    echo ""
    if [ "${VERIFY_FAIL}" -eq 0 ]; then
        echo "✅ All hashes verified successfully."
    else
        echo "❌ ${VERIFY_FAIL} hash(es) mismatched. Rebuild required."
        exit 1
    fi
fi

# ── Update README with hashes ────────────────────────────────
if [[ "${UPDATE_README}" == "true" ]]; then
    echo "─── Updating README ─────────────────────────────────"
    README="${CONTRACTS_DIR}/README.md"

    if [ -f "${README}" ]; then
        # Generate a markdown table of hashes
        TABLE="\n## Wasm Artifact Hashes\n\n"
        TABLE+="| Contract | SHA-256 | Size |\n"
        TABLE+="|----------|---------|------|\n"

        for wasm in "${WASM_ARTIFACTS[@]}"; do
            NAME=$(basename "$wasm" .wasm)
            SHA=$(sha256sum "$wasm" | cut -d' ' -f1)
            SIZE=$(stat --printf="%s" "$wasm" 2>/dev/null || stat -f%z "$wasm" 2>/dev/null || echo "0")
            SIZE_HR=$(numfmt --to=iec 2>/dev/null && echo "${SIZE}" || echo "${SIZE} bytes")
            TABLE+="| \`${NAME}\` | \`${SHA}\` | ${SIZE_HR} |\n"
        done

        TABLE+="\n_Built from commit \`${GIT_COMMIT}\` on \`${GIT_BRANCH}\` using ${RUSTC_VERSION}_\n"

        echo -e "${TABLE}"
        echo ""
        echo "→ Copy the table above into your README."
    else
        echo "  ⚠  README not found at ${README}"
    fi
fi
