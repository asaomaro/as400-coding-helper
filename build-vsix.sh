#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$SCRIPT_DIR/vscode-extension"

echo "=== VSIX Build ==="
cd "$EXT_DIR"

echo "[1/4] npm install..."
npm install

echo "[2/4] vsce の確認..."
if ! command -v vsce &>/dev/null; then
  echo "  -> @vscode/vsce をグローバルインストールします..."
  npm install -g @vscode/vsce
fi

echo "[3/4] TypeScript コンパイル..."
npm run compile

echo "[4/4] VSIX パッケージ生成..."
vsce package --out "$SCRIPT_DIR"

echo ""
echo "完了: $(ls "$SCRIPT_DIR"/*.vsix 2>/dev/null | tail -1)"
