#!/usr/bin/env bash
# NovaGrid Android build (novagrid-059, этап 2/3 мобильной версии):
#   1. сверяет версии package.json / desktop/tauri.conf.json / desktop/Cargo.toml
#      (+ tauri.android.conf.json, если там есть своя version) — рассинхрон
#      превращает «последнюю версию» в ложную, падаем сразу;
#   2. builds the frontend (dist/, единый с вебом/десктопом);
#   3. `tauri android build` → APK из того же крейта desktop/ (мобильная ветка
#      lib.rs, gen/android);
#   4. copies it to builds/novagrid-<version>-android-<type>/NovaGrid-<version>-android-<type>.apk
#      (release подписан keystore’ом desktop/gen/android/novagrid-release.keystore,
#      пароль в gitignored keystore.properties — нет файла → unsigned-APK с предупреждением).
# Toolchain defaults (env overrides win): ANDROID_HOME=%LOCALAPPDATA%/Android/Sdk,
# NDK_HOME=<highest ndk>, JAVA_HOME=Android Studio jbr, gnu rust toolchain — docs/WRAPPER.md.
# Usage: scripts/android-build.sh [debug|release] [targets...]   (default release aarch64)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TYPE="${1:-release}"
if [ "$TYPE" = "debug" ] || [ "$TYPE" = "release" ]; then shift; else TYPE=release; fi
# таргеты: по умолчанию aarch64 (телефоны) для release; debug — + x86_64 (эмулятор)
if [ $# -gt 0 ]; then TARGETS=("$@"); else
  if [ "$TYPE" = "debug" ]; then TARGETS=(aarch64 x86_64); else TARGETS=(aarch64); fi
fi

VER="$(node -p "require('./package.json').version")"
CONF_VER="$(node -p "require('./desktop/tauri.conf.json').version")"
CARGO_VER="$(grep -m1 '^version' desktop/Cargo.toml | sed 's/version *= *"\(.*\)"/\1/')"
ACONF_VER="$(node -p "require('./desktop/tauri.android.conf.json').version || ''" 2>/dev/null || true)"
if [ "$VER" != "$CONF_VER" ] || [ "$VER" != "$CARGO_VER" ] || { [ -n "$ACONF_VER" ] && [ "$ACONF_VER" != "$VER" ]; }; then
  echo "!! Версии разошлись: package.json=$VER tauri.conf.json=$CONF_VER Cargo.toml=$CARGO_VER tauri.android.conf.json=${ACONF_VER:-<наследует>} — сверите и повторите" >&2
  exit 1
fi

# тулчейн Android (согласовано с android-dev.sh)
export ANDROID_HOME="${ANDROID_HOME:-$(cygpath -m "$LOCALAPPDATA/Android/Sdk")}"
if [ -z "${NDK_HOME:-}" ]; then
  NDK_VER="$(ls "$ANDROID_HOME/ndk" | sort -V | tail -1)"
  export NDK_HOME="$ANDROID_HOME/ndk/$NDK_VER"
fi
export JAVA_HOME="${JAVA_HOME:-$(cygpath -m '/c/Program Files/Android/Android Studio/jbr')}"
export RUSTUP_TOOLCHAIN="${RUSTUP_TOOLCHAIN:-stable-x86_64-pc-windows-gnu}"
export PATH="/c/Users/CUSTOM/msys64/ucrt64/bin:$PATH"

# 1) frontend (тот же dist/, что едят веб и десктоп)
echo "==> Building frontend..."
npm run build

# 2) APK через tauri CLI (cwd desktop/: там tauri.conf.json и gen/android);
#    release — режим CLI по умолчанию, отдельный флаг только у debug
echo "==> Building android shell ($TYPE, targets: ${TARGETS[*]})..."
TYPE_FLAG=(); [ "$TYPE" = "debug" ] && TYPE_FLAG=(--debug)
(cd desktop && node ../node_modules/@tauri-apps/cli/tauri.js android build "${TYPE_FLAG[@]}" --apk --target "${TARGETS[@]}")

# 3) артефакт → builds/ (версия + тип — правила проекта)
APK_SRC="desktop/gen/android/app/build/outputs/apk/universal/$TYPE/app-universal-$TYPE.apk"
[ -f "$APK_SRC" ] || { echo "!! APK не найден: $APK_SRC" >&2; exit 1; }
mkdir -p "$ROOT/builds/novagrid-$VER-android-$TYPE"

# подпись release: keystore.properties (секрет, в git не входит) + keystore
SIGNED=""
if [ "$TYPE" = "release" ]; then
  if [ -f desktop/gen/android/keystore.properties ]; then
    BT="$(ls "$ANDROID_HOME/build-tools" | sort -V | tail -1)"
    if MSYS_NO_PATHCONV=1 "$ANDROID_HOME/build-tools/$BT/apksigner.bat" verify --print-certs \
        "$(cygpath -w "$APK_SRC")" >/dev/null 2>&1; then
      SIGNED="yes"
    fi
  fi
  if [ -n "$SIGNED" ]; then
    echo "==> APK подписан (novagrid-release.keystore)"
  else
    echo "!! APK НЕ подписан: нет desktop/gen/android/keystore.properties или apksigner failed —" >&2
    echo "   на телефон не встанет. Схема подписи — docs/WRAPPER.md «Android»." >&2
  fi
fi

SUFFIX=""
if [ "$TYPE" = "release" ] && [ -z "$SIGNED" ]; then SUFFIX="-unsigned"; fi
APK_NAME="NovaGrid-$VER-android-$TYPE$SUFFIX.apk"
cp -f "$APK_SRC" "$ROOT/builds/novagrid-$VER-android-$TYPE/$APK_NAME"
echo "==> Done: builds/novagrid-$VER-android-$TYPE/$APK_NAME"
