# Soroban SDK Upgrade Path

This document describes how to safely upgrade the Soroban SDK version used by the Oraculum contracts, using the compatibility check tooling.

## Prerequisites

- Rust toolchain (minimum 1.75.0)
- `wasm32-unknown-unknown` target installed
- Git commit containing all current changes

## Quick Start

```bash
# 1. Check current version compatibility
./scripts/check-sdk-compat.sh

# 2. Update SDK version in Cargo.toml
# Edit contracts/Cargo.toml to update soroban-sdk version

# 3. Run full compatibility check
./scripts/check-sdk-compat.sh --full

# 4. Run preflight checks before deployment
./scripts/preflight-check.sh --deploy
```

## Upgrade Steps

### 1. Check Current Compatibility

```bash
./scripts/check-sdk-compat.sh
```

This verifies:
- Rust toolchain version meets minimum requirements
- Wasm32 target is installed
- All crates compile successfully
- No deprecation warnings
- Tests pass

### 2. Update SDK Version

Edit `contracts/Cargo.toml`:

```toml
[workspace.dependencies]
soroban-sdk = "X.Y.Z"  # Update to target version
```

### 3. Run Compatibility Check

```bash
./scripts/check-sdk-compat.sh --check-version X.Y.Z --full
```

This generates a compatibility report in `scripts/sdk-compat-report-X.Y.Z.md`.

### 4. Fix Breaking Changes

Major version bumps (e.g., 23 → 24) may include breaking changes:

| SDK Version | Notable Changes |
|------------|-----------------|
| 23.x → 24.x | Check for storage API changes, event API updates |
| 22.x → 23.x | Auth interface changes, wasm format updates |
| 21.x → 22.x | Token interface changes, SDK restructuring |

Refer to the [Soroban SDK Changelog](https://github.com/stellar/soroban-sdk/blob/main/CHANGELOG.md)
for detailed migration guides.

### 5. Verify Wasm Artifacts

```bash
./scripts/generate-wasm-hash.sh --build --verify
```

This ensures deterministic builds and captures the new hashes.

### 6. Preflight Check

```bash
./scripts/preflight-check.sh --deploy
```

Runs the full validation suite before deployment.

### 7. Commit Changes

```bash
git add contracts/Cargo.toml contracts/Cargo.lock scripts/wasm-hashes.json scripts/sdk-compat-report-X.Y.Z.md
git commit -m "chore(sdk): upgrade Soroban SDK to X.Y.Z"
```

## Known Compatible Versions

```bash
./scripts/check-sdk-compat.sh --list-versions
```

| SDK Version | Min Rustc | Status |
|-------------|-----------|--------|
| 23.4.1      | 1.75.0    | Production |
| 23.4.0      | 1.75.0    | Previous |
| 23.3.0      | 1.75.0    | LTS |
| 22.0.0      | 1.74.0    | Legacy |
| 21.0.0      | 1.73.0    | Unsupported |

## Rollback Procedure

If an upgrade introduces issues:

1. Revert SDK version in `Cargo.toml`
2. Revert `Cargo.lock` to previous version
3. Verify with `./scripts/check-sdk-compat.sh`
4. Regenerate wasm hashes

## CI Integration

The compatibility checks complement the existing CI pipeline:

- **Build Check**: Ensures compilation succeeds
- **Test Suite**: Validates all tests pass
- **Coverage**: Monitors code coverage changes (via CI coverage job)
- **Preflight Check**: Available as a local script — run before deployment to validate builds, tests, and wasm artifacts

> **Note**: The preflight check script (`scripts/preflight-check.sh`) is designed for local execution. Run it before any deployment to catch issues early.

## Troubleshooting

### "wasm32-unknown-unknown target not found"

```bash
rustup target add wasm32-unknown-unknown
```

### "Rustc version below minimum"

```bash
rustup update stable
rustup default stable
```

### "Build failures after SDK upgrade"

1. Check the Soroban SDK changelog for migration guides
2. Look for deprecated API alternatives
3. Update contract code to use new APIs
4. Run `./scripts/check-sdk-compat.sh --full` to verify
