#!/usr/bin/env bash
# NovaGrid desktop build (Этап 7.5, novagrid-018):
#   1. builds the frontend (dist/)
#   2. builds the release exe (GNU toolchain, MSYS2 ucrt64 in PATH — see
#      docs/WRAPPER.md) with the frontend embedded (custom-protocol)
#   3. copies it to builds/novagrid-<version>-portable-<type>.exe — the bare
#      exe is the OTA asset of the Aila update center (novagrid-036; the
#      client swaps exactly this file, setups and zips are for humans)
#   4. compiles the Inno Setup installer to
#      builds/novagrid-<version>-setup-<type>.exe (release only)
#   5. publishes the release to the Aila update center (novagrid-036):
#      node D:\Scheduler\tools\publish-update.cjs novagrid — manifest v2 with
#      sha256 + history + «📦 Обновление …» in the AI hub
#   6. updates the deployed portable copy in C:\NovaGrid (release only,
#      novagrid-021: scripts/deploy-portable.sh)
# Version comes from package.json (single source with the web app).
# Usage: scripts/desktop-build.sh [debug|release]   (default release)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TYPE="${1:-release}"
VER="$(node -p "require('./package.json').version")"

# единый источник версии — package.json; обёртка сверяет с манифестом канала
# по CARGO_PKG_VERSION, рассинхрон превратил бы «последнюю версию» в ложную
CONF_VER="$(node -p "require('./desktop/tauri.conf.json').version")"
CARGO_VER="$(grep -m1 '^version' desktop/Cargo.toml | sed 's/version *= *"\(.*\)"/\1/')"
if [ "$VER" != "$CONF_VER" ] || [ "$VER" != "$CARGO_VER" ]; then
  echo "!! Версии разошлись: package.json=$VER tauri.conf.json=$CONF_VER Cargo.toml=$CARGO_VER — сверите и повторите" >&2
  exit 1
fi

# 1) frontend
echo "==> Building frontend..."
npm run build

# 2) release binary (MSYS2 ucrt64 provides gcc/dlltool for the GNU toolchain).
#    --features custom-protocol embeds the frontend into the exe (what
#    `tauri build` does); without it the window would wait for a dev server.
export PATH="/c/Users/CUSTOM/msys64/ucrt64/bin:$PATH"
echo "==> Building desktop shell ($TYPE)..."
(cd desktop && cargo +stable-x86_64-pc-windows-gnu build --"$TYPE" --bin novagrid --features custom-protocol)

# 3) version + type -> builds/ (portable: папка exe+DLL, упаковывается в zip;
#    голый exe рядом — OTA-ассет центра обновлений, novagrid-036)
mkdir -p "$ROOT/builds"
PORTDIR="$ROOT/builds/novagrid-$VER-portable-$TYPE"
mkdir -p "$PORTDIR"
cp -f "desktop/target/$TYPE/novagrid.exe" "$PORTDIR/NovaGrid.exe"
cp -f desktop/lib/WebView2Loader.dll "$PORTDIR/"
cp -f "desktop/target/$TYPE/novagrid.exe" "$ROOT/builds/novagrid-$VER-portable-$TYPE.exe"
(cd "$ROOT/builds" && powershell -NoProfile -Command \
  "Compress-Archive -Force -Path 'novagrid-$VER-portable-$TYPE/*' -DestinationPath 'novagrid-$VER-portable-$TYPE.zip'")
echo "==> Portable: $PORTDIR (+ .zip, + OTA-exe)"

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

# 5) публикация релиза в центр обновлений Aila (novagrid-036): манифест v2
#    (sha256, notes из последней записи CHANGELOG) + история + сообщение в
#    «Хаб ИИ». До локального деплоя — канал должен получить релиз раньше
#    домашней копии. Инструмент диспетчера отсутствует (чужая машина) —
#    пропускаем с предупреждением; сервер недоступен — сборка падает
#    (aila.skillcoin.pp.ua — семья, Aila должна работать; поднять:
#    schtasks /run /tn AilaRestart).
if [ "$TYPE" = "release" ]; then
  PUBLISH_TOOL="/d/Scheduler/tools/publish-update.cjs"
  if [ -f "$PUBLISH_TOOL" ]; then
    echo "==> Publishing $VER to the Aila update center..."
    # node — Windows-программа: MSYS-пути /d/… разворачивает относительно
    # текущего диска (D:\d\…) — отдаём виндовые (cygpath), как ISCC выше
    node "$(cygpath -w "$PUBLISH_TOOL")" novagrid --notes-file "$(cygpath -w "$ROOT/CHANGELOG.md")"
  else
    echo "!! D:\\Scheduler\\tools\\publish-update.cjs не найден — публикация в центр обновлений пропущена." >&2
  fi
fi

# 6) deployed copy C:\NovaGrid follows every release automatically (novagrid-021)
if [ "$TYPE" = "release" ]; then
  "$ROOT/scripts/deploy-portable.sh" "$PORTDIR"
fi
