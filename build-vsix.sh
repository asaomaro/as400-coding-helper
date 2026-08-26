#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$SCRIPT_DIR/vscode-extension"

echo "=== VSIX Build ==="

# npm workspaces 化により、依存の導入とビルドはリポジトリのルートで行う。
# 拡張ディレクトリで npm install しても npm はワークスペース全体を対象にするため、
# 意図を明示する意味でもルートで実行する。
echo "[1/4] npm install（ルートで workspaces 一括）..."
cd "$SCRIPT_DIR"
npm install

echo "[2/4] ビルド（dds-core → dds-cli → 拡張の依存順）..."
npm run build

echo "[3/4] vsce の確認..."
if ! command -v vsce &>/dev/null; then
  echo "  -> vsce が無いため npx @vscode/vsce を使用します"
  VSCE=(npx --yes @vscode/vsce)
else
  VSCE=(vsce)
fi

echo "[4/4] VSIX パッケージ生成..."
# --no-dependencies は必須。付けないと vsce が @as400/dds-core（node_modules 内の
# workspace symlink）をたどってリポジトリ全体を VSIX に取り込もうとして失敗する。
# 依存は esbuild で dist/extension.js に畳んであるので、同梱する必要がない。
# 経緯: .aidev/works/20260825-dds-visual-editor/01-workspace/decisions.md D1
cd "$EXT_DIR"
"${VSCE[@]}" package --no-dependencies --out "$SCRIPT_DIR"

echo ""
echo "完了: $(ls "$SCRIPT_DIR"/*.vsix 2>/dev/null | tail -1)"
