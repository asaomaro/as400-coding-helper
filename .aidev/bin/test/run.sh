#!/bin/sh
# aidev CLI テスト（status / metrics / worktree / 既存回帰 / sh⇔ps1 パリティ）。Node 非依存。
# 使い方: sh .aidev/bin/test/run.sh
# 一時フィクスチャ（works/backlog/metrics）を作り、aidev の出力を期待値と照合する。
set -u

SELF=$(cd "$(dirname "$0")" && pwd)
BIN="$SELF/.."
AIDEV_SH="$BIN/aidev"
AIDEV_PS1="$BIN/aidev.ps1"

PASS=0; FAIL=0; SKIP=0
ok()   { PASS=$((PASS+1)); printf '  ok: %s\n' "$1"; }
ng()   { FAIL=$((FAIL+1)); printf '  NG: %s\n' "$1" >&2; }
# 環境不足で検証を飛ばしたら skip() を使う。RESULT に skip 件数を出して「未検証の穴」を可視化する(#32)。
skip() { SKIP=$((SKIP+1)); printf '  skip: %s\n' "$1"; }
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

echo "== worktree =="
if command -v git >/dev/null 2>&1; then
  # フィクスチャ git リポジトリを $TMP/repo に作る（既定 worktree パスは $TMP/repo-wt/* ＝ $TMP 配下なので
  # 既存 trap の rm -rf "$TMP" で worktree ごと自動掃除される）。
  REPO="$TMP/repo"
  mkdir -p "$REPO/.aidev/bin"
  cp "$AIDEV_SH" "$REPO/.aidev/bin/aidev"; chmod +x "$REPO/.aidev/bin/aidev"
  printf '.aidev/current\n' > "$REPO/.gitignore"
  (
    cd "$REPO"
    git init -q
    git config user.email t@example.com; git config user.name tester
    git add -A; git commit -qm init >/dev/null 2>&1
  )
  run_repo() { ( cd "$REPO" && "$AIDEV_SH" "$@" ); }

  # add（add 内で new）
  ADD_OUT=$(run_repo worktree add probe 2>&1); ADD_RC=$?
  assert_eq "$ADD_RC" "0" "worktree add exit 0"
  assert_contains "$ADD_OUT" "worktree 追加" "add: 追加メッセージ"
  assert_contains "$ADD_OUT" "languageId" "add: 規約警告(languageId)を出力"
  WP="$TMP/repo-wt/probe"
  assert_eq "$([ -d "$WP" ] && echo yes || echo no)" "yes" "add: 既定 path に worktree 作成"
  WT_CUR=$(cat "$WP/.aidev/current" 2>/dev/null)
  assert_contains "$WT_CUR" "-probe" "add: worktree current が dated probe work を指す"
  # INV-1: main(repo) tree の current は add で作られない/変わらない（gitignore＝worktree ローカル）
  assert_eq "$([ -f "$REPO/.aidev/current" ] && echo yes || echo no)" "no" "INV-1: main の current は不変(未作成)"

  # list（判定キー=current 有無。probe worktree が出る）
  L_TSV=$(run_repo worktree list --format tsv)
  assert_contains "$L_TSV" "worktree	$WP	feature/probe" "list: probe を current 有無で抽出(branch=feature/probe)"
  L_TBL=$(run_repo worktree list)
  assert_contains "$L_TBL" "WORKTREES" "list: table ヘッダ"

  # 異常系
  run_repo worktree bogus >/dev/null 2>&1; assert_eq "$?" "1" "未知 sub は exit 1"
  run_repo worktree add >/dev/null 2>&1; assert_eq "$?" "1" "slug 無し add は exit 1"
  run_repo worktree list --format bogus >/dev/null 2>&1; assert_eq "$?" "1" "list 不正 --format は exit 1"

  # rm（未コミット work フォルダがあるので --force 無しは拒否）
  run_repo worktree rm probe >/dev/null 2>&1; assert_eq "$?" "1" "rm: 未コミット差分で既定拒否(exit 1)"
  assert_eq "$([ -d "$WP" ] && echo yes || echo no)" "yes" "rm: 拒否時は worktree 残存"
  RM_OUT=$(run_repo worktree rm probe --force --delete-branch 2>&1); assert_eq "$?" "0" "rm --force --delete-branch exit 0"
  assert_contains "$RM_OUT" "branch 削除: feature/probe" "rm: --delete-branch でブランチ削除"
  assert_eq "$([ -d "$WP" ] && echo yes || echo no)" "no" "rm: worktree 撤去済み"
  ( cd "$REPO" && git show-ref --verify --quiet refs/heads/feature/probe ); assert_eq "$?" "1" "rm: ブランチも削除済み"
  # INV-1（rm 後も main current 不変＝未作成のまま）
  assert_eq "$([ -f "$REPO/.aidev/current" ] && echo yes || echo no)" "no" "INV-1: rm 後も main current 不変"

  # #33: slug が main worktree(basename=repo) に一致しても rm 対象にせず、明確なメッセージで拒否する
  RMM_OUT=$(run_repo worktree rm repo 2>&1); RMM_RC=$?
  assert_eq "$RMM_RC" "1" "rm: main worktree に一致する slug は exit 1"
  assert_contains "$RMM_OUT" "main worktree は rm できません" "rm: main worktree 一致時は明確な文言で拒否"
  assert_eq "$([ -d "$REPO" ] && echo yes || echo no)" "yes" "rm: main worktree は削除されない"
else
  skip "git 不在のため worktree テストを省略"
fi

echo "== sh ⇔ ps1 パリティ =="
if command -v pwsh >/dev/null 2>&1; then
  for args in "status --format tsv" "metrics --all --format tsv" "metrics 20260101-alpha --phases --format tsv"; do
    # shellcheck disable=SC2086
    O_SH=$( ( cd "$TMP" && "$AIDEV_SH" $args ) )
    # shellcheck disable=SC2086
    O_PS=$( ( cd "$TMP" && pwsh "$AIDEV_PS1" $args ) | tr -d '\r' )
    assert_eq "$O_SH" "$O_PS" "パリティ: $args"
  done

  # worktree パリティ（git 必須）: ps1 の worktree 実装を実機で検証する（#28）。
  # pwsh 不在の開発機では skip されるため、ps1 の worktree は本節（pwsh 環境/CI）で初めて実行検証される。
  if command -v git >/dev/null 2>&1; then
    PREPO="$TMP/prepo"
    mkdir -p "$PREPO/.aidev/bin" "$PREPO/.aidev/works/20260101-existing"
    cp "$AIDEV_SH"  "$PREPO/.aidev/bin/aidev";     chmod +x "$PREPO/.aidev/bin/aidev"
    cp "$AIDEV_PS1" "$PREPO/.aidev/bin/aidev.ps1"
    printf '.aidev/current\n' > "$PREPO/.gitignore"
    # 既存work一致 add の回帰用に slug:existing の work をコミットしておく
    cat > "$PREPO/.aidev/works/20260101-existing/state.yml" <<'YML'
schema: 2
slug: existing
current: spec
approved: [requirement, spec]
mode: interactive
humanGates: []
maxSendBacks: 3
dependsOn: []
YML
    printf 'events:\n' > "$PREPO/.aidev/works/20260101-existing/metrics.yml"
    ( cd "$PREPO" && git init -q && git config user.email t@example.com && git config user.name tester \
        && git add -A && git commit -qm init >/dev/null 2>&1 )

    # (1) sh で worktree を1つ作り、list の出力を sh⇔ps1 で突合（同一 git 状態・同一 current を読むので一致するはず）
    ( cd "$PREPO" && "$AIDEV_SH" worktree add probe >/dev/null 2>&1 )
    WL_SH=$( ( cd "$PREPO" && "$AIDEV_SH"      worktree list --format tsv ) )
    WL_PS=$( ( cd "$PREPO" && pwsh "$AIDEV_PS1" worktree list --format tsv ) | tr -d '\r' )
    assert_eq "$WL_SH" "$WL_PS" "パリティ: worktree list --format tsv"

    # (2) ps1 の add（既存work一致＝current 設定のみ）。current が full dated 名であること
    #     ＝ review 検出の must「PowerShell 単一要素配列アンラップ($mw[0]が先頭1文字)」の回帰ガード
    PW_OUT=$( ( cd "$PREPO" && pwsh "$AIDEV_PS1" worktree add existing ) | tr -d '\r' )
    PW_CUR=$(cat "$TMP/prepo-wt/existing/.aidev/current" 2>/dev/null)
    assert_eq "$PW_CUR" "20260101-existing" "パリティ: ps1 add(既存work) current=full dated 名(\$mw アンラップ回帰)"
    assert_contains "$PW_OUT" "既存 work をリンク" "パリティ: ps1 add は既存をリンク(new 委譲せず)"
  else
    skip "git 不在のため worktree パリティを省略"
  fi
else
  skip "pwsh 不在のためパリティテストを省略"
fi

echo
printf 'RESULT: pass=%s fail=%s skip=%s\n' "$PASS" "$FAIL" "$SKIP"
# skip>0＝環境不足で未実行の検証（未検証の穴）。deliver/PR で「未検証 surface」として引き継ぐこと(#32)。
[ "$SKIP" -gt 0 ] && printf 'NOTE: %s 件の検証が環境不足で skip された（未検証の穴）。pwsh/git のある環境(CI)で再実行して埋めること。\n' "$SKIP" >&2
[ "$FAIL" -eq 0 ]
