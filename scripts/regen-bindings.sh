#!/usr/bin/env bash
# scripts/regen-bindings.sh
#
# Regenerates TypeScript bindings for Zenith's Soroban contracts.
# Requires: stellar CLI (https://github.com/stellar/stellar-cli)
#
# Usage:
#   NETWORK=testnet bash scripts/regen-bindings.sh
#
# Reads contract IDs from env vars:
#   NEXT_PUBLIC_CONTRACT_MARKET_<NETWORK>
#   NEXT_PUBLIC_CONTRACT_VAULT_<NETWORK>
#   NEXT_PUBLIC_CONTRACT_ORACLE_<NETWORK>

set -euo pipefail

NETWORK="${NETWORK:-testnet}"
OUT_DIR="src/lib/soroban/contracts"

declare -A CONTRACTS=(
  ["market"]="NEXT_PUBLIC_CONTRACT_MARKET_${NETWORK^^}"
  ["vault"]="NEXT_PUBLIC_CONTRACT_VAULT_${NETWORK^^}"
  ["oracle"]="NEXT_PUBLIC_CONTRACT_ORACLE_${NETWORK^^}"
)

echo "[regen-bindings] Network: $NETWORK"

for name in "${!CONTRACTS[@]}"; do
  env_var="${CONTRACTS[$name]}"
  contract_id="${!env_var:-}"

  if [[ -z "$contract_id" ]]; then
    echo "  [skip] $name: $env_var not set"
    continue
  fi

  echo "  [gen] $name ($contract_id) → $OUT_DIR/${name}.ts"

  stellar contract bindings typescript \
    --network "$NETWORK" \
    --contract-id "$contract_id" \
    --output-dir "$OUT_DIR/${name}-generated" \
    --overwrite

  # The generated package exports a Client class; re-export it from our index.
  # In practice you'd copy/merge the generated output into the contracts folder.
  echo "  [ok] $name bindings generated in $OUT_DIR/${name}-generated"
done

echo "[regen-bindings] Done. Review generated files and update $OUT_DIR/index.ts."
