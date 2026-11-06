#!/usr/bin/env bash
# NovaGrid desktop dev mode (Этап 7.5): vite devserver on :5173 (devUrl in
# desktop/tauri.conf.json) + cargo run WITHOUT custom-protocol, so the window
# loads the dev server with HMR. Ctrl+C stops both.
# Prereqs: MSYS2 ucrt64 (gcc/dlltool for the GNU toolchain) — docs/WRAPPER.md.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

npm run dev -- --port 5173 &
VITE_PID=$!
trap 'kill "$VITE_PID" 2>/dev/null || true' EXIT

export PATH="/c/Users/CUSTOM/msys64/ucrt64/bin:$PATH"
cd desktop && cargo +stable-x86_64-pc-windows-gnu run --bin novagrid
