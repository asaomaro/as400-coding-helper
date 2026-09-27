#!/usr/bin/env bash
# VSIX を作る。出力はこのスクリプトと同じ場所（リポジトリ直下）。
#
#   ./build-vsix.sh            # 依存を入れてから作る
#   ./build-vsix.sh --no-install
#
# vsce は版を固定して npx で呼ぶ（グローバルに入れない。WSL で Windows 側の vsce を拾わない）。
# コンパイル（tsc ＋ WebView の esbuild）は vsce が package.json の vscode:prepublish で行う。
# 同梱するものは vscode-extension/.vscodeignore で決める。
# repository と LICENSE が無いと vsce が続行するか聞いて止まるので、聞かずに進める（private リポジトリ）。
set -euo pipefail

VSCE_VERSION="3.9.2"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$SCRIPT_DIR/vscode-extension"
OUT_DIR="${VSIX_OUT_DIR:-$SCRIPT_DIR}"

cd "$EXT_DIR"
NAME="$(node -p "require('./package.json').name")"
VERSION="$(node -p "require('./package.json').version")"
VSIX="$OUT_DIR/$NAME-$VERSION.vsix"

echo "=== VSIX Build: $NAME $VERSION ==="

if [ "${1:-}" != "--no-install" ]; then
  echo "[1/3] 依存を入れる（npm install）"
  npm install
else
  echo "[1/3] 依存を入れる — 省略（--no-install）"
fi

echo "[2/3] コンパイルとパッケージ（@vscode/vsce@$VSCE_VERSION）"
npx --yes "@vscode/vsce@$VSCE_VERSION" package --out "$VSIX" --allow-missing-repository --skip-license

echo "[3/3] 中身の確認"
# 実行に要るものが入っていて、入れないはずのものが無いこと。
LIST="$(unzip -Z1 "$VSIX")"
missing=0
for required in \
  extension/out/extension/extension.js \
  extension/out/dds-webview/editor.js \
  extension/out/prompter-webview/prompter.js \
  extension/out/sync-webview/sync.js \
  extension/node_modules/ssh2/package.json \
  extension/resources/prompter; do
  if ! grep -q "^$required" <<<"$LIST"; then
    echo "  NG: $required が入っていない"
    missing=1
  fi
done
for forbidden in extension/src/ extension/test/ extension/out-test/ extension/dev/ extension/node_modules/playwright-core/; do
  if grep -q "^$forbidden" <<<"$LIST"; then
    echo "  NG: $forbidden が入っている（.vscodeignore を確認）"
    missing=1
  fi
done
if [ "$missing" -ne 0 ]; then
  exit 1
fi

echo ""
echo "完了: $VSIX（$(wc -l <<<"$LIST") ファイル）"
