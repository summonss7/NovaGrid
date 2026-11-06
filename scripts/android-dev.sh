#!/usr/bin/env bash
# NovaGrid Android dev mode (novagrid-059): vite devserver on :5173 (devUrl in
# desktop/tauri.conf.json) + `tauri android dev <device>`, which builds the
# mobile lib, installs the debug APK on the connected device/emulator and
# reloads the WebView from the dev server (HMR inside the Android WebView).
# Ctrl+C stops both. Device: первый из подключённых (adb), иначе — аргумент:
#   npm run android:dev -- emulator-5554
# Без устройства CLI виснет в интерактивном выборе — стартуйте эмулятор:
#   emulator -avd lecards_test     # or Android Studio Device Manager
# Prereqs (defaults match this machine, env overrides win):
#   ANDROID_HOME, NDK_HOME, JAVA_HOME + rust android targets — docs/WRAPPER.md.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# тулчейн по умолчанию (как в android-build.sh; детали — docs/WRAPPER.md)
export ANDROID_HOME="${ANDROID_HOME:-$(cygpath -m "$LOCALAPPDATA/Android/Sdk")}"
if [ -z "${NDK_HOME:-}" ]; then
  NDK_VER="$(ls "$ANDROID_HOME/ndk" | sort -V | tail -1)"
  export NDK_HOME="$ANDROID_HOME/ndk/$NDK_VER"
fi
export JAVA_HOME="${JAVA_HOME:-$(cygpath -m '/c/Program Files/Android/Android Studio/jbr')}"
# gnu-тулчейн rust (msvc без линкера) + gcc хоста для build-скриптов крейтов
export RUSTUP_TOOLCHAIN="${RUSTUP_TOOLCHAIN:-stable-x86_64-pc-windows-gnu}"
export PATH="/c/Users/CUSTOM/msys64/ucrt64/bin:$PATH"

# устройство: аргумент скрипта → первый подключённый adb; без устройства
# CLI уходит в интерактивный выбор и виснет в не-tty среде
ADB="${ANDROID_HOME}/platform-tools/adb"
DEVICE="${1:-}"
if [ -z "$DEVICE" ]; then
  DEVICE="$("$ADB" devices | awk 'NR>1 && $2=="device"{print $1; exit}')"
fi
if [ -z "$DEVICE" ]; then
  echo "!! Нет подключённых устройств: запустите эмулятор (emulator -avd lecards_test) или передайте устройство: npm run android:dev -- emulator-5554" >&2
  exit 1
fi
echo "==> Device: $DEVICE"

# vite на 0.0.0.0: эмулятор/телефон не видят localhost хоста, tauri адресует
# devUrl на LAN-IP (TAURI_DEV_HOST) и иначе вечно ждёт «Waiting for your
# frontend dev server to start on http://<lan-ip>:5173/»
npm run dev -- --port 5173 --host 0.0.0.0 &
VITE_PID=$!
trap 'kill "$VITE_PID" 2>/dev/null || true' EXIT

(cd desktop && node ../node_modules/@tauri-apps/cli/tauri.js android dev "$DEVICE")
