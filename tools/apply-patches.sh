#!/usr/bin/env bash
# Apply patches/*.patch to the 86Box submodule (idempotent).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/86Box"
for p in "$ROOT"/patches/*.patch; do
  [ -e "$p" ] || continue
  if git apply --reverse --check "$p" 2>/dev/null; then
    continue # already applied
  fi
  echo "Applying $(basename "$p")"
  git apply "$p"
done
