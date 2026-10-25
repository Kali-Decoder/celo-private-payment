#!/usr/bin/env bash
# Build Redsand withdraw circuit end-to-end (BN254 / Ethereum Groth16):
#   compile → powers of tau → Groth16 setup → export vk → test proof → Verifier.sol
#
# Tracked (safe to commit):
#   artifacts/withdraw_vk.json
#   proofs/withdraw_proof.json + withdraw_public.json (test fixture)
#   ../hardhat-contracts/contracts/verifiers/WithdrawVerifier.sol  (generated)
#
# Gitignored (toxic / large):
#   artifacts/*.ptau  *.zkey  *.r1cs  *_js/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ART="$ROOT/artifacts"
KEYS="$ROOT/keys"
PROOFS="$ROOT/proofs"
CIRCUITS="$ROOT/circuits"
SNARKJS="${SNARKJS:-$ROOT/node_modules/.bin/snarkjs}"
CIRCOM="${CIRCOM:-circom}"

if ! command -v "$CIRCOM" >/dev/null 2>&1; then
  if [ -x "$HOME/.local/bin/circom" ]; then
    CIRCOM="$HOME/.local/bin/circom"
  elif [ -x "$HOME/.cargo/bin/circom" ]; then
    CIRCOM="$HOME/.cargo/bin/circom"
  else
    echo "error: circom not found. Install: https://docs.circom.io/getting-started/installation/"
    echo "  cargo install --git https://github.com/iden3/circom.git circom --locked"
    exit 1
  fi
fi

if [ ! -x "$SNARKJS" ]; then
  echo "error: snarkjs missing. Run: cd zk && pnpm install --ignore-workspace"
  exit 1
fi

mkdir -p "$ART" "$KEYS" "$PROOFS"

echo "== [1/6] compile withdraw.circom (bn128) =="
"$CIRCOM" "$CIRCUITS/withdraw.circom" --r1cs --wasm --sym -p bn128 -o "$ART"
"$SNARKJS" r1cs info "$ART/withdraw.r1cs"

# Constraint count → pot power. Depth-20 Poseidon ≈ ~11k constraints → pot 14.
POT_POWER="${POT_POWER:-14}"

echo "== [2/6] powers of tau (bn128, power ${POT_POWER}) =="
PTAU="$ART/pot${POT_POWER}_final.ptau"
if [ ! -f "$PTAU" ]; then
  "$SNARKJS" powersoftau new bn128 "$POT_POWER" "$ART/pot${POT_POWER}_0.ptau" -v
  "$SNARKJS" powersoftau contribute "$ART/pot${POT_POWER}_0.ptau" "$ART/pot${POT_POWER}_1.ptau" \
    --name="redsand-withdraw" -v -e="$(date +%s%N)redsandentropy"
  "$SNARKJS" powersoftau prepare phase2 "$ART/pot${POT_POWER}_1.ptau" "$PTAU" -v
  rm -f "$ART/pot${POT_POWER}_0.ptau" "$ART/pot${POT_POWER}_1.ptau"
  echo "generated $PTAU"
else
  echo "reusing $PTAU"
fi

echo "== [3/6] Groth16 setup =="
ZKEY="$KEYS/withdraw.zkey"
if [ -f "$ZKEY" ] && [ "${FORCE_SETUP:-0}" != "1" ]; then
  echo "reusing $ZKEY (set FORCE_SETUP=1 to rotate)"
else
  "$SNARKJS" groth16 setup "$ART/withdraw.r1cs" "$PTAU" "$ART/withdraw_0.zkey"
  "$SNARKJS" zkey contribute "$ART/withdraw_0.zkey" "$ZKEY" \
    --name="redsand-withdraw" -v -e="$(date +%s%N)redsandzkey"
  rm -f "$ART/withdraw_0.zkey"
fi

echo "== [4/6] export verification key =="
"$SNARKJS" zkey export verificationkey "$ZKEY" "$ART/withdraw_vk.json"

echo "== [5/6] generate test proof =="
node "$ROOT/scripts/gen-test-proof.mjs"

echo "== [6/6] export Solidity verifier =="
node "$ROOT/scripts/export-verifier.mjs"

echo ""
echo "== DONE =="
echo "  vk:       $ART/withdraw_vk.json"
echo "  zkey:     $ZKEY"
echo "  wasm:     $ART/withdraw_js/withdraw.wasm"
echo "  verifier: $ROOT/../hardhat-contracts/contracts/verifiers/WithdrawVerifier.sol"
