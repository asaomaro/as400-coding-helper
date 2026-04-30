#!/bin/bash
set -e

echo "=== Installing global npm packages ==="
npm install -g @anthropic-ai/claude-code
echo "✓ claude installed"

echo "=== Installing project dependencies ==="
cd /workspaces/as400-coding-helper/vscode-extension
npm ci
echo "✓ npm ci done"

echo "=== Setup complete ==="
