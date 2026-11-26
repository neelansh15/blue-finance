#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd "$(dirname "$0")/.." && pwd)"
dependency_dir="$project_root/protocol-old/lib"
mkdir -p "$dependency_dir"
if [ ! -d "$dependency_dir/forge-std" ]; then
  git clone --branch v1.9.7 --depth 1 https://github.com/foundry-rs/forge-std.git "$dependency_dir/forge-std"
fi
test "$(git -C "$dependency_dir/forge-std" describe --tags --exact-match)" = "v1.9.7"

morpho_revision=f8631a27a2ee76ccd63abb945014d31d9efb0aca
if [ ! -d "$dependency_dir/morpho-blue" ]; then
  git clone https://github.com/morpho-org/morpho-blue.git "$dependency_dir/morpho-blue"
  git -C "$dependency_dir/morpho-blue" checkout --detach "$morpho_revision"
fi
test "$(git -C "$dependency_dir/morpho-blue" rev-parse HEAD)" = "$morpho_revision"
git -C "$dependency_dir/morpho-blue" diff --exit-code -- src
# Morpho pins solc 0.8.19. Build its unchanged source separately; Blue stays on 0.8.28.
forge build src/Morpho.sol --root "$dependency_dir/morpho-blue" --use 0.8.19 --evm-version paris --skip test --skip script

mkdir -p "$project_root/protocol-old/test/fixtures/generated"
cp "$dependency_dir/morpho-blue/out/Morpho.sol/Morpho.json" "$project_root/protocol-old/test/fixtures/generated/Morpho.json"
