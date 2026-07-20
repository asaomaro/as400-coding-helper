#!/bin/sh
# CL コマンド定義(CDML XML)を実機の QCDRCMDD API で取得できるか検証する。
#
# 目的は DEP(相関チェック) / PMTCTL(条件表示) が取れるかの確認。
# 原典 https://www.ibm.com/docs/ssw_ibm_i_75/apis/qcdrcmdd.htm より:
#   - DEP / PMTCTL が入るのは受取形式 CMDD0200 のみ（CMDD0100 は
#     「有効なコマンド文字列を組み立てるのに必要な分」だけの部分集合）
#   - 出力先形式 DEST0200 でストリーム・ファイルへ。UTF-8(CCSID 1208)で作られる
#   - 公開権限 *USE / コマンド *USE / ライブラリー *EXECUTE
#
# **共用機(pub400)への配慮**: 全コマンド(2000件超)の一括抽出はしない。
# 引数で渡した数件だけを取る。既定は DEP/PMTCTL を持つと分かっている代表例。
#
# 使い方:
#   PUB400_PASSWORD=xxxx docs/origin/probe-cmd-definition.sh MAROBENI [CMD...]
set -eu

USER_NAME="${1:?ユーザー名を指定する}"
shift
HOST="${PUB400_HOST:-pub400.com}"
PORT="${PUB400_PORT:-2222}"
OUTDIR="${OUTDIR:-docs/origin/cmddef}"

# 既定の検証対象。SNDPGMMSG は MSGID→MSGF の条件必須(DEP)、
# CRTPF / CHGPRTF は入力に応じて出る欄が変わる(PMTCTL)ことが期待される。
if [ "$#" -eq 0 ]; then
  set -- SNDPGMMSG CRTPF CHGPRTF SBMJOB
fi

# パスワードは引数に取らない（プロセス一覧に出るため）。環境変数で受ける。
: "${PUB400_PASSWORD:?PUB400_PASSWORD を環境変数で渡す}"
SSHPASS="$PUB400_PASSWORD"
export SSHPASS

# pub400 はパスワード要求の文言が独自なので -P で教える。
ssh_run() {
  sshpass -P "password" -e ssh -p "$PORT" -o StrictHostKeyChecking=no \
    "$USER_NAME@$HOST" "$@"
}

REMOTE_DIR="/home/$USER_NAME/cmddef"
mkdir -p "$OUTDIR"
ssh_run "mkdir -p $REMOTE_DIR" >/dev/null

# 「パス名形式」構造体(32バイト+パス)を 16 進で組み立てる。
# 原典 https://www.ibm.com/docs/ssw_ibm_i_75/apiref/pns.htm
#   0  BINARY(4) CCSID            … 1208 を明示して UTF-8 でパスを渡す
#   4  CHAR(2)   国識別コード     … X'0000'  (ジョブの既定を使う)
#   6  CHAR(3)   言語識別コード   … X'000000'(ジョブの既定を使う)
#   9  CHAR(3)   予約             … 16 進ゼロ
#   12 BINARY(4) パス・タイプ標識 … 0 = 文字パス・区切り文字は 1 バイト
#   16 BINARY(4) パス名の長さ
#   20 CHAR(2)   パス名区切り文字 … パス名と同じ CCSID の '/'。タイプ 0 では
#                                   2 バイト欄の 1 文字目だけが使われる
#   22 CHAR(10)  予約             … 16 進ゼロ
#   32 CHAR(*)   パス名
#
# **空白ではなく 16 進ゼロ**。原典は予約欄を「16 進ゼロに設定しなければならない」、
# 国/言語識別コードを X'0000'/X'000000' と規定している。空白を入れると実機は
# CPE3021『引数に指定した値が正しくありません』を返す（実際に踏んだ）。
path_struct_hex() {
  printf '%s' "$1" | python3 -c '
import sys
p = sys.stdin.buffer.read()
s = (1208).to_bytes(4, "big") + bytes(8) + (0).to_bytes(4, "big") \
    + len(p).to_bytes(4, "big") + b"/" + bytes(1) + bytes(10) + p
sys.stdout.write(s.hex().upper())
'
}

for CMD in "$@"; do
  REMOTE_FILE="$REMOTE_DIR/$CMD.xml"
  HEX=$(path_struct_hex "$REMOTE_FILE")
  # CHAR(20) 修飾コマンド名 = コマンド10桁 + ライブラリー10桁。
  QUAL=$(printf '%-10s%-10s' "$CMD" "QSYS")
  # 誤り符号は「提供バイト数 0」にして、失敗をエスケープ・メッセージで出させる
  # （戻り値を読み取る経路が無いため、ssh の出力に出るのが都合がよい）。
  echo "=== $CMD ==="
  ssh_run "system \"CALL PGM(QSYS/QCDRCMDD) PARM('$QUAL' X'$HEX' 'DEST0200' \
    X'0000000000000000' 'CMDD0200' X'0000000000000000')\"" 2>&1 |
    grep -vE "WELCOME|Please take|do not disturb|other users|limited support|all access|see https|^\*+ ?\*?$|^ $|Enter your password|^\* " || true
done

# まとめて回収する（scp の起動回数を減らす）。
sshpass -P "password" -e scp -P "$PORT" -o StrictHostKeyChecking=no \
  "$USER_NAME@$HOST:$REMOTE_DIR/*.xml" "$OUTDIR/"

ls -l "$OUTDIR"
