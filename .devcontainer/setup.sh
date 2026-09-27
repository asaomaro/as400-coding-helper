#!/bin/bash
set -e

echo "=== Installing global npm packages ==="
npm install -g @anthropic-ai/claude-code
echo "✓ claude installed"

echo "=== Installing project dependencies ==="
# リポジトリのフォルダ名に依らない（改名しても動くように）。
cd "$(dirname "$0")/../vscode-extension"
npm ci
echo "✓ npm ci done"

echo "=== Setup complete ==="
