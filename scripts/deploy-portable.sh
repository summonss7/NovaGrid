#!/usr/bin/env bash
# Обновление развёрнутой портативной копии NovaGrid в C:\NovaGrid
# (карточка novagrid-021). Правило проекта: при выпуске новой версии
# копия у владельца обновляется автоматически — desktop-build.sh
# (release) вызывает этот скрипт в конце сборки.
# Ручной запуск (догнать пропущенный релиз):
#   scripts/deploy-portable.sh [папка портабельной сборки]
# Без аргумента берётся builds/novagrid-<версия>-portable-release
# (версия — из package.json, единый источник).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DEPLOY_DIR="/c/NovaGrid"
VER="$(node -p "require('./package.json').version")"
SRC="${1:-$ROOT/builds/novagrid-$VER-portable-release}"

[ -f "$SRC/NovaGrid.exe" ] || {
  echo "!! $SRC/NovaGrid.exe не найден — сначала соберите десктоп (npm run desktop:build)" >&2
  exit 1
}

if [ ! -d "$DEPLOY_DIR" ]; then
  echo "==> Развёрнутая копия $DEPLOY_DIR не найдена — обновление пропущено."
  exit 0
fi

echo "==> Updating $DEPLOY_DIR ($(basename "$SRC"))..."
# exe запущен — cp упадёт «file in use»: закрыть окно NovaGrid и повторить
cp -f "$SRC/NovaGrid.exe" "$SRC/WebView2Loader.dll" "$DEPLOY_DIR/"

SUM_SRC="$(md5sum "$SRC/NovaGrid.exe" | cut -d' ' -f1)"
SUM_DST="$(md5sum "$DEPLOY_DIR/NovaGrid.exe" | cut -d' ' -f1)"
[ "$SUM_SRC" = "$SUM_DST" ] || { echo "!! Контрольная сумма не совпала с артефактом сборки" >&2; exit 1; }
echo "    C:\\NovaGrid обновлён до $VER (NovaGrid.exe md5 ${SUM_DST:0:8}…)."
