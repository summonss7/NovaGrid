#!/usr/bin/env bash
# NovaGrid desktop build (Этап 7.5, novagrid-018):
#   1. builds the frontend (dist/)
#   2. builds the release exe (GNU toolchain, MSYS2 ucrt64 in PATH — see
#      docs/WRAPPER.md) with the frontend embedded (custom-protocol)
#   3. copies it to builds/novagrid-<version>-portable-<type>.exe
#   4. compiles the Inno Setup installer to
#      builds/novagrid-<version>-setup-<type>.exe (release only)
#   5. updates the deployed portable copy in C:\NovaGrid (release only,
#      novagrid-021: scripts/deploy-portable.sh)
# Version comes from package.json (single source with the web app).
# Usage: scripts/desktop-build.sh [debug|release]   (default release)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TYPE="${1:-release}"
VER="$(node -p "require('./package.json').version")"

# 1) frontend
echo "==> Building frontend..."
npm run build

# 2) release binary (MSYS2 ucrt64 provides gcc/dlltool for the GNU toolchain).
#    --features custom-protocol embeds the frontend into the exe (what
#    `tauri build` does); without it the window would wait for a dev server.
export PATH="/c/Users/CUSTOM/msys64/ucrt64/bin:$PATH"
echo "==> Building desktop shell ($TYPE)..."
(cd desktop && cargo +stable-x86_64-pc-windows-gnu build --"$TYPE" --features custom-protocol)

# 3) version + type -> builds/ (portable: папка exe+DLL, упаковывается в zip)
mkdir -p "$ROOT/builds"
PORTDIR="$ROOT/builds/novagrid-$VER-portable-$TYPE"
mkdir -p "$PORTDIR"
cp -f "desktop/target/$TYPE/novagrid.exe" "$PORTDIR/NovaGrid.exe"
cp -f desktop/lib/WebView2Loader.dll "$PORTDIR/"
(cd "$ROOT/builds" && powershell -NoProfile -Command \
  "Compress-Archive -Force -Path 'novagrid-$VER-portable-$TYPE/*' -DestinationPath 'novagrid-$VER-portable-$TYPE.zip'")
echo "==> Portable: $PORTDIR (+ .zip)"

# 4) installer (Inno Setup, per-user, file associations — desktop/installer.iss)
if [ "$TYPE" = "release" ]; then
  ISCC="${ISCC:-$LOCALAPPDATA/Programs/Inno Setup 6/ISCC.exe}"
  if [ -x "$ISCC" ]; then
    echo "==> Compiling setup (Inno Setup ${VER})..."
    # MSYS bash rewrites arguments that look like Unix paths (/D..., /O...)
    # into Windows paths — disable the conversion for this call.
    export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*"
    BUILDS_WIN="$(cygpath -w "$ROOT/builds")"
    "$ISCC" /DAppVersion="$VER" /DType="$TYPE" /O"$BUILDS_WIN" \
      "$(cygpath -w "$ROOT/desktop/installer.iss")"
    SETUP="$ROOT/builds/novagrid-$VER-setup-$TYPE.exe"
    [ -f "$SETUP" ] || { echo "!! ISCC reported success but $SETUP is missing" >&2; exit 1; }
    echo "==> Setup: $SETUP"
  else
    echo "==> Skipping the setup: Inno Setup not found (portable exe is ready)."
    echo "    Per-user install (no admin): winget install --id JRSoftware.InnoSetup --scope user"
  fi
fi

# 5) deployed copy C:\NovaGrid follows every release automatically (novagrid-021)
if [ "$TYPE" = "release" ]; then
  "$ROOT/scripts/deploy-portable.sh" "$PORTDIR"
fi
