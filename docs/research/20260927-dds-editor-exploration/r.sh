#!/bin/sh
# 使い方: ./r.sh <<'JS' ... JS   （lib.js を前に付けてドライバーで実行）
cat lib.js - | curl -s --data-binary @- 127.0.0.1:47111/eval
