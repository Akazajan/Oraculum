#!/usr/bin/env bash
set -euo pipefail

# ────────────────────────────────────────────────────────────────
# scripts/coverage.sh — Code-coverage runner for Oraculum contracts
#
# Prerequisites:
#   cargo-tarpaulin  (install: cargo install cargo-tarpaulin)
#   grcov            (install: cargo install grcov)
#   rust-nightly     (for llvm-profiling with grcov)
#
# Usage:
#   ./scripts/coverage.sh              # run all contracts with tarpaulin (default)
#   ./scripts/coverage.sh --engine grcov   # run with grcov instead
#   ./scripts/coverage.sh --open           # open HTML report after generation
# ────────────────────────────────────────────────────────────────

ENGINE="tarpaulin"
OPEN_REPORT="false"
WORKSPACE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPORT_DIR="${WORKSPACE_DIR}/target/coverage"

# ── Parse arguments ────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --engine) ENGINE="$2"; shift 2 ;;
        --open)   OPEN_REPORT="true"; shift ;;
        *)        echo "Unknown option: $1"; exit 1 ;;
    esac
done

echo "━━━ Oraculum Coverage Report ━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Engine:   ${ENGINE}"
echo "  Contracts workspace: ${WORKSPACE_DIR}/contracts"
echo ""

mkdir -p "${REPORT_DIR}"

# ── Coverage via cargo-tarpaulin ───────────────────────────────
if [[ "${ENGINE}" == "tarpaulin" ]]; then
    if ! command -v cargo-tarpaulin &>/dev/null; then
        echo "Error: cargo-tarpaulin not installed."
        echo "  Run: cargo install cargo-tarpaulin"
        exit 1
    fi

    echo "→ Running cargo-tarpaulin on contract workspace…"
    cd "${WORKSPACE_DIR}/contracts"

    cargo tarpaulin \
        --workspace \
        --all-features \
        --out Html \
        --out Xml \
        --output-dir "${REPORT_DIR}" \
        --skip-clean \
        --verbose

    echo ""
    echo "✓ Coverage report generated:"
    echo "  HTML: ${REPORT_DIR}/tarpaulin-report.html"
    echo "  XML:  ${REPORT_DIR}/cobertura.xml"

# ── Coverage via grcov (nightly / llvm-profiling) ─────────────
elif [[ "${ENGINE}" == "grcov" ]]; then
    if ! command -v grcov &>/dev/null; then
        echo "Error: grcov not installed."
        echo "  Run: cargo install grcov"
        exit 1
    fi

    echo "→ Running tests with llvm profiling (requires nightly)…"
    cd "${WORKSPACE_DIR}/contracts"

    export CARGO_INCREMENTAL=0
    export RUSTFLAGS="-Cinstrument-coverage"
    export RUSTDOCFLAGS="-Cinstrument-coverage"
    export LLVM_PROFILE_FILE="${REPORT_DIR}/cargo-test-%p-%m.profraw"

    cargo test --workspace --all-features

    echo "→ Generating coverage with grcov…"
    grcov "${REPORT_DIR}" \
        --source-dir "${WORKSPACE_DIR}/contracts" \
        --output-type html \
        --branch \
        --ignore-not-existing \
        --ignore "/*" \
        --ignore "**/tests/*" \
        --ignore "**/test.rs" \
        --ignore "**/target/**" \
        --output-path "${REPORT_DIR}/grcov-report"

    echo ""
    echo "✓ Coverage report generated:"
    echo "  HTML: ${REPORT_DIR}/grcov-report/index.html"

    # Clean up profraw files
    rm -f "${REPORT_DIR}"/*.profraw
else
    echo "Error: unknown engine '${ENGINE}'. Use 'tarpaulin' or 'grcov'."
    exit 1
fi

# ── Optionally open the report ────────────────────────────────
if [[ "${OPEN_REPORT}" == "true" ]]; then
    REPORT_FILE="${REPORT_DIR}/tarpaulin-report.html"
    [[ "${ENGINE}" == "grcov" ]] && REPORT_FILE="${REPORT_DIR}/grcov-report/index.html"

    if command -v xdg-open &>/dev/null; then
        xdg-open "${REPORT_FILE}"
    elif command -v open &>/dev/null; then
        open "${REPORT_FILE}"
    else
        echo "→ Report available at: ${REPORT_FILE}"
    fi
fi
