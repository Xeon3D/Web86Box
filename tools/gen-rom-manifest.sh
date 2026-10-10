#!/usr/bin/env bash
# Write <roms dir>/manifest.txt listing every ROM file (paths relative to
# the ROM directory). The emulator reads it at startup to know which ROMs
# exist without downloading them.
#
#   tools/gen-rom-manifest.sh dist/roms
set -euo pipefail
DIR="${1:?usage: $0 <roms dir>}"
cd "$DIR"
find . -type f ! -path './.git/*' ! -name manifest.txt ! -name '*.md' ! -name LICENSE \
  | sed 's|^\./||' | LC_ALL=C sort > manifest.txt
echo "$(wc -l < manifest.txt) files listed in $DIR/manifest.txt"
