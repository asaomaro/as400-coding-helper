#!/bin/sh
# 既存の CL プロンプター定義に対応する CDML(コマンド定義 XML)を実機から一括取得する。
#
# 目的は DEP(相関チェック) / PMTCTL(条件表示) の収集。取得可能性そのものは
# docs/origin/probe-cmd-definition.sh で検証済み（PR #92）。
#
# **共用機(pub400)への配慮**: ssh ログインは 1 回だけ。全 CALL を 1 本の
# シェル・スクリプトにまとめて送り込み、結果は tar 1 本で回収する。
# コマンドごとに ssh を張ると 250 回のログインになるため、その形は採らない。
#
# 取得できないコマンドがある。pub400 では CRTLIB / CRTSBSD / ENDSBS /
# RSTOBJ / SNDBRKMSG が CPF9802(権限なし)。失敗は記録して続行する。
#
# 使い方:
#   PUB400_PASSWORD=xxxx docs/origin/collect-cmd-definitions.sh MAROBENI
set -eu

USER_NAME="${1:?ユーザー名を指定する}"
HOST="${PUB400_HOST:-pub400.com}"
PORT="${PUB400_PORT:-2222}"
DEFDIR="${DEFDIR:-vscode-extension/resources/prompter/cl/ja}"
OUTDIR="${OUTDIR:-docs/origin/cmddef}"
WORK="${TMPDIR:-/tmp}/collect-cmddef.$$"

: "${PUB400_PASSWORD:?PUB400_PASSWORD を環境変数で渡す}"
SSHPASS="$PUB400_PASSWORD"
export SSHPASS

ssh_run() {
  sshpass -P "password" -e ssh -p "$PORT" -o StrictHostKeyChecking=no \
    "$USER_NAME@$HOST" "$@"
}
scp_get() {
  sshpass -P "password" -e scp -P "$PORT" -o StrictHostKeyChecking=no \
    "$USER_NAME@$HOST:$1" "$2"
}
scp_put() {
  sshpass -P "password" -e scp -P "$PORT" -o StrictHostKeyChecking=no "$1" \
    "$USER_NAME@$HOST:$2"
}

REMOTE_DIR="/home/$USER_NAME/cmddef"
mkdir -p "$WORK" "$OUTDIR"
trap 'rm -rf "$WORK"' EXIT

ls "$DEFDIR"/*.json | xargs -n1 basename | sed 's/\.json$//' > "$WORK/cmds.txt"
echo "対象 $(wc -l < "$WORK/cmds.txt") コマンド"

# 実機で走らせるスクリプトを組み立てる。「パス名形式」構造体の作り方と
# 16 進ゼロの規定は probe-cmd-definition.sh のコメントを参照。
python3 - "$WORK/cmds.txt" "$REMOTE_DIR" > "$WORK/run.sh" <<'PY'
import sys
cmds = open(sys.argv[1]).read().split()
rdir = sys.argv[2]
print(f"mkdir -p {rdir}")
for c in cmds:
    p = f"{rdir}/{c}.xml".encode()
    s = ((1208).to_bytes(4, "big") + bytes(8) + (0).to_bytes(4, "big")
         + len(p).to_bytes(4, "big") + b"/" + bytes(1) + bytes(10) + p)
    qual = f"{c:<10}{'QSYS':<10}"
    call = (f"CALL PGM(QSYS/QCDRCMDD) PARM('{qual}' X'{s.hex().upper()}' "
            f"'DEST0200' X'0000000000000000' 'CMDD0200' X'0000000000000000')")
    # 失敗しても続行する。成否は 1 行 1 コマンドで記録する。
    print(f'if system "{call}" >/dev/null 2>&1; then echo "OK {c}"; '
          f'else echo "NG {c}"; fi')
print(f"cd {rdir} && tar cf ../cmddef.tar *.xml && echo DONE")
PY

scp_put "$WORK/run.sh" "/home/$USER_NAME/run.sh" >/dev/null 2>&1
ssh_run "sh /home/$USER_NAME/run.sh" 2>&1 | grep -E "^(OK|NG|DONE) *" > "$WORK/result.txt" || true

echo "取得成功 $(grep -c '^OK ' "$WORK/result.txt" || echo 0) / 失敗 $(grep -c '^NG ' "$WORK/result.txt" || echo 0)"
grep '^NG ' "$WORK/result.txt" | awk '{print "  取得できず: " $2}' || true
grep -q '^DONE' "$WORK/result.txt" || { echo "実機側で tar が作られなかった"; exit 1; }

scp_get "/home/$USER_NAME/cmddef.tar" "$WORK/cmddef.tar" >/dev/null 2>&1
tar xf "$WORK/cmddef.tar" -C "$OUTDIR"
ssh_run "rm -rf $REMOTE_DIR /home/$USER_NAME/cmddef.tar /home/$USER_NAME/run.sh" >/dev/null 2>&1

echo "回収 $(ls "$OUTDIR"/*.xml | wc -l) 件 → $OUTDIR"
