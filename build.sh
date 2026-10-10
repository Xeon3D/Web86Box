#!/usr/bin/env bash
# Build Web86Box: 86Box compiled to WebAssembly plus the web frontend.
#
#   ./build.sh            release build into dist/
#   BUILD_TYPE=Debug ./build.sh
#
# Requires an activated Emscripten SDK (emcmake/emcc on PATH).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_TYPE="${BUILD_TYPE:-Release}"
BUILD_DIR="${BUILD_DIR:-$ROOT/build/$BUILD_TYPE}"
DIST_DIR="${DIST_DIR:-$ROOT/dist}"

command -v emcmake >/dev/null || { echo "emcmake not found: activate the Emscripten SDK first" >&2; exit 1; }

# 86Box sources (git submodule) + our patches.
if [ ! -f "$ROOT/86Box/CMakeLists.txt" ]; then
  git -C "$ROOT" submodule update --init 86Box
fi
"$ROOT/tools/apply-patches.sh"

case "$BUILD_TYPE" in
  Debug) OPT="-O1 -g"; LINK_EXTRA="-sASSERTIONS=1" ;;
  *)     OPT="-O3";    LINK_EXTRA="" ;;
esac

emcmake cmake -S "$ROOT/86Box" -B "$BUILD_DIR" -G Ninja \
  -DCMAKE_BUILD_TYPE="$BUILD_TYPE" \
  -DCMAKE_C_FLAGS="-pthread -sMEMORY64=1 $OPT" \
  -DCMAKE_CXX_FLAGS="-pthread -sMEMORY64=1 -fwasm-exceptions $OPT" \
  -DCMAKE_EXE_LINKER_FLAGS="-pthread -sMEMORY64=1 -fwasm-exceptions $OPT $LINK_EXTRA" \
  -DWEB86BOX_PLATFORM_DIR="$ROOT/platform" \
  -DQT=OFF -DDYNAREC=OFF -DNEW_DYNAREC=OFF -DOPENAL=OFF \
  -DRTMIDI=OFF -DFLUIDSYNTH=OFF -DMUNT=ON -DSOUNDCANVAS=OFF \
  -DDISCORD=OFF -DVNC=OFF -DMINITRACE=OFF -DGDBSTUB=OFF \
  -DCPPTHREADS=ON -DSTATIC_BUILD=OFF -DRELEASE=$([ "$BUILD_TYPE" = Debug ] && echo OFF || echo ON)

cmake --build "$BUILD_DIR" --target 86Box

# Assemble the site.
mkdir -p "$DIST_DIR/icons/systemicons"
cp "$BUILD_DIR"/src/86Box.mjs "$BUILD_DIR"/src/86Box.wasm "$DIST_DIR"/
cp -r "$ROOT"/web/. "$DIST_DIR"/
# 86Box's own Qt icons, so the UI looks like the desktop version.
cp "$ROOT"/86Box/src/qt/icons/*.ico "$DIST_DIR"/icons/
cp "$ROOT"/86Box/src/qt/assets/systemicons/*.png "$DIST_DIR"/icons/systemicons/
(cd "$DIST_DIR"/icons/systemicons && ls *.png | python3 -c 'import json,sys; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))') > "$DIST_DIR"/icons/systemicons.json

# ROM set: ROMS_DIR=<checkout of github.com/86Box/roms> copies it into the
# site (the emulator downloads individual ROMs on demand). Without it, an
# existing dist/roms is kept.
if [ -n "${ROMS_DIR:-}" ]; then
  mkdir -p "$DIST_DIR/roms"
  rsync -a --delete --exclude .git "$ROMS_DIR"/ "$DIST_DIR/roms/" 2>/dev/null \
    || (cd "$ROMS_DIR" && tar --exclude=.git -cf - . | tar -xf - -C "$DIST_DIR/roms")
fi
if [ -d "$DIST_DIR/roms" ]; then
  "$ROOT"/tools/gen-rom-manifest.sh "$DIST_DIR/roms"
else
  echo "warning: no ROMs in $DIST_DIR/roms (set ROMS_DIR); machines will be unavailable" >&2
fi
echo "Built into $DIST_DIR"
