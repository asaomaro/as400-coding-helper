#!/bin/sh
# aidev CLI テスト（status / metrics / 既存回帰 / sh⇔ps1 パリティ）。Node 非依存。
# 使い方: sh .aidev/bin/test/run.sh
# 一時フィクスチャ（works/backlog/metrics）を作り、aidev の出力を期待値と照合する。
set -u

SELF=$(cd "$(dirname "$0")" && pwd)
BIN="$SELF/.."
AIDEV_SH="$BIN/aidev"
AIDEV_PS1="$BIN/aidev.ps1"

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf '  ok: %s\n' "$1"; }
ng()   { FAIL=$((FAIL+1)); printf '  NG: %s\n' "$1" >&2; }
assert_contains() { # haystack needle desc
  case "$1" in *"$2"*) ok "$3" ;; *) ng "$3 (期待を含まず: [$2])"; printf '    出力:\n%s\n' "$1" >&2 ;; esac
}
assert_absent() { # haystack needle desc
  case "$1" in *"$2"*) ng "$3 (含んではいけない: [$2])" ;; *) ok "$3" ;; esac
}
assert_eq() { # got want desc
  if [ "$1" = "$2" ]; then ok "$3"; else ng "$3 (got=[$1] want=[$2])"; fi
}

# ---- フィクスチャ作成 -------------------------------------------------------
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/.aidev/works" "$TMP/.aidev/backlog/archive"

# alpha: 完了（deliver 済・schema 2）。metrics に手戻り(coding 2回)/sent_back/リードタイム。
mkdir -p "$TMP/.aidev/works/20260101-alpha"
cat > "$TMP/.aidev/works/20260101-alpha/state.yml" <<'EOF'
schema: 2
slug: alpha
current: deliver
approved: [requirement, research, spec, plan, coding, test, review, deliver]
mode: autonomous
humanGates: []
maxSendBacks: 3
dependsOn: []
EOF
cat > "$TMP/.aidev/works/20260101-alpha/metrics.yml" <<'EOF'
events:
  - { ts: 2026-01-01T00:00:00Z, phase: requirement, event: start }
  - { ts: 2026-01-01T00:10:00Z, phase: requirement, event: approved }
  - { ts: 2026-01-01T00:30:00Z, phase: spec, event: sent_back }
  - { ts: 2026-01-01T01:00:00Z, phase: coding, event: start }
  - { ts: 2026-01-01T01:05:00Z, phase: coding, event: start }
  - { ts: 2026-01-01T02:00:00Z, phase: coding, event: approved }
  - { ts: 2026-01-01T03:00:00Z, phase: deliver, event: approved }
EOF
# review 承認済なので review.md が必要（verify schema>=2 の不変条件）
printf '# レビュー記録\n' > "$TMP/.aidev/works/20260101-alpha/review.md"

# beta: 進行中（spec まで承認）。dependsOn: alpha(充足) + #99(advisory)。
mkdir -p "$TMP/.aidev/works/20260102-beta"
cat > "$TMP/.aidev/works/20260102-beta/state.yml" <<'EOF'
schema: 2
slug: beta
ticket: "#42"
current: spec
approved: [requirement, research, spec]
mode: interactive
humanGates: []
maxSendBacks: 3
dependsOn: [20260101-alpha, #99]
EOF
printf 'events:\n' > "$TMP/.aidev/works/20260102-beta/metrics.yml"

# legacy: schema 無し・approved 空。
mkdir -p "$TMP/.aidev/works/20260103-legacy"
cat > "$TMP/.aidev/works/20260103-legacy/state.yml" <<'EOF'
slug: legacy
current: requirement
approved: []
EOF

# backlog（archive 配下は除外されること）
cat > "$TMP/.aidev/backlog/x.md" <<'EOF'
- [ ] a
- [ ] b (needs: #1)
- [x] done
EOF
cat > "$TMP/.aidev/backlog/archive/old.md" <<'EOF'
- [ ] should-not-count
EOF

printf '20260102-beta\n' > "$TMP/.aidev/current"

run_sh() { ( cd "$TMP" && "$AIDEV_SH" "$@" ); }

echo "== status =="
ST_TSV=$(run_sh status --format tsv)
assert_contains "$ST_TSV" "work	20260101-alpha	-	autonomous	deliver	-	yes	ok" "alpha: 完了行(next=-/done=yes/deps=ok)"
assert_contains "$ST_TSV" "work	20260102-beta	#42	interactive	spec	plan	no	#99(advisory)" "beta: next=plan/done=no/deps=#99(advisory)（alpha は充足）"
assert_contains "$ST_TSV" "work	20260103-legacy	-	-	requirement	requirement	no	ok" "legacy: schema無しでも一覧化(next=requirement)"
assert_contains "$ST_TSV" "backlog	x.md	2	1" "backlog x.md: todo=2/needs=1"
assert_absent  "$ST_TSV" "should-not-count" "archive/ は除外される"

ST_TBL=$(run_sh status)
assert_contains "$ST_TBL" "WORKS (3)" "table: WORKS 件数"
assert_contains "$ST_TBL" "BACKLOG (未着手 2 件)" "table: BACKLOG 未着手件数"

echo "== status 異常系 =="
run_sh status --format bogus >/dev/null 2>&1; assert_eq "$?" "1" "不正 --format は exit 1"

echo "== metrics =="
MT=$(run_sh metrics --all --format tsv)
assert_contains "$MT" "20260101-alpha	2026-01-01T00:00:00Z	yes	10800	1	1" "alpha: lead=10800/reworks=1/sent_backs=1"
assert_contains "$MT" "20260103-legacy	-	no	-	0	0" "legacy: metrics空でも 0/-"
MTP=$(run_sh metrics 20260101-alpha --phases --format tsv)
assert_contains "$MTP" "20260101-alpha	coding	2026-01-01T01:05:00Z	2026-01-01T02:00:00Z	3300" "alpha --phases: coding は直近start基準で elapsed=3300"
assert_contains "$MTP" "20260101-alpha	requirement	2026-01-01T00:00:00Z	2026-01-01T00:10:00Z	600" "alpha --phases: requirement elapsed=600"

echo "== 読み取り専用（status/metrics は state/metrics を書き換えない） =="
SUM1=$(cat "$TMP/.aidev/works"/*/state.yml "$TMP/.aidev/works"/*/metrics.yml | cksum)
run_sh status >/dev/null; run_sh status --format tsv >/dev/null
run_sh metrics --all >/dev/null; run_sh metrics 20260101-alpha --phases >/dev/null
SUM2=$(cat "$TMP/.aidev/works"/*/state.yml "$TMP/.aidev/works"/*/metrics.yml | cksum)
assert_eq "$SUM1" "$SUM2" "status/metrics 実行後も state/metrics 不変"

echo "== 既存コマンド回帰 =="
run_sh verify 20260101-alpha >/dev/null 2>&1; assert_eq "$?" "0" "verify(alpha) exit 0"
run_sh doctor >/dev/null 2>&1; assert_eq "$?" "0" "doctor exit 0"
# beta は plan 前提(spec.md)が無いので guard plan は exit 2
run_sh guard plan >/dev/null 2>&1; assert_eq "$?" "2" "guard plan(前提成果物なし) exit 2"
G_OUT=$(run_sh guard spec 2>&1); echo "$G_OUT" | grep -q "advisory" && ok "guard: #99 を advisory(warn) 表示" || ng "guard advisory 表示"

echo "== sh ⇔ ps1 パリティ =="
if command -v pwsh >/dev/null 2>&1; then
  for args in "status --format tsv" "metrics --all --format tsv" "metrics 20260101-alpha --phases --format tsv"; do
    # shellcheck disable=SC2086
    O_SH=$( ( cd "$TMP" && "$AIDEV_SH" $args ) )
    # shellcheck disable=SC2086
    O_PS=$( ( cd "$TMP" && pwsh "$AIDEV_PS1" $args ) | tr -d '\r' )
    assert_eq "$O_SH" "$O_PS" "パリティ: $args"
  done
else
  printf '  skip: pwsh 不在のためパリティテストを省略\n'
fi

echo
printf 'RESULT: pass=%s fail=%s\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
