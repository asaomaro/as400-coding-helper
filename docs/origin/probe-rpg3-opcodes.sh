#!/bin/sh
# RPG III(RPG/400) の命令コード集合を実機のコンパイラに判定させる。
#
# IBM の RPG/400 Reference は ibm.com/docs に生 HTML が無く、PDF(SC09-1817)も
# 公開経路から取得できない。よって「原典」は実機のコンパイラそのものとする。
# RPG/400 は命令コード欄に知らない語が来ると QRG5014 を出すので、それで弾く。
#
# 結果は docs/origin/rpg3-opcodes-on-ibmi.json に手で写す（実機が要るため CI では回さない）。
#
# 使い方:
#   PUB400_PASSWORD=xxxx docs/origin/probe-rpg3-opcodes.sh MAROBENI MAROBENI1
set -eu

USER_NAME="${1:?ユーザー名を指定する}"
LIBRARY="${2:?作業ライブラリーを指定する}"
HOST="${PUB400_HOST:-pub400.com}"
PORT="${PUB400_PORT:-2222}"
PROBE="${PROBE_SOURCE:-docs/origin/rpg3-opcode-probe.rpg}"

# パスワードは引数に取らない（プロセス一覧に出るため）。環境変数で受ける。
: "${PUB400_PASSWORD:?PUB400_PASSWORD を環境変数で渡す}"
SSHPASS="$PUB400_PASSWORD"
export SSHPASS

# pub400 はパスワード要求の文言が独自なので -P で教える。
ssh_run() {
  sshpass -P "password" -e ssh -p "$PORT" -o StrictHostKeyChecking=no "$USER_NAME@$HOST" "$@"
}

sshpass -P "password" -e scp -P "$PORT" -o StrictHostKeyChecking=no \
  "$PROBE" "$USER_NAME@$HOST:/home/$USER_NAME/probe.rpg"

ssh_run "system \"CRTSRCPF FILE($LIBRARY/QRPGSRC) RCDLEN(92)\"" >/dev/null 2>&1 || true
ssh_run "system \"ADDPFM FILE($LIBRARY/QRPGSRC) MBR(PROBE) SRCTYPE(RPG)\"" >/dev/null 2>&1 || true

# OPTION(*SOURCE) でソース・リストを出す。GENLVL(50) はエラーがあっても
# 最後まで診断させるため（この検証では必ずエラーになる）。
ssh_run "system \"CPYFRMSTMF FROMSTMF('/home/$USER_NAME/probe.rpg') TOMBR('/QSYS.LIB/$LIBRARY.LIB/QRPGSRC.FILE/PROBE.MBR') MBROPT(*REPLACE)\" >/dev/null; system \"CRTRPGPGM PGM($LIBRARY/PROBE) SRCFILE($LIBRARY/QRPGSRC) SRCMBR(PROBE) OPTION(*SOURCE) GENLVL(50)\""
