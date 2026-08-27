#!/bin/bash
# e2e の再現率を測る。**不安定なまま CI に載せると赤を無視する習慣がつく**ので、
# 10 回連続で緑になることを先に確かめる（backlog dds.md の条件）。
cd /workspaces/as400-coding-helper/vscode-extension
pass=0; fail=0
for i in $(seq 1 10); do
  start=$(date +%s)
  if out=$(timeout 300 node dev/e2e.mjs 2>&1); then
    n=$(echo "$out" | grep -oE '=== [0-9]+/[0-9]+ PASS ===' | head -1)
    pass=$((pass+1))
    echo "run $i: OK   $n  ($(( $(date +%s) - start ))s)"
  else
    fail=$((fail+1))
    echo "run $i: NG   ($(( $(date +%s) - start ))s)"
    echo "$out" | grep -E "^FAIL|Error" | head -5
  fi
done
echo "STABILITY: pass=$pass fail=$fail"
