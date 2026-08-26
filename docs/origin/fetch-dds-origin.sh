#!/usr/bin/env sh
# DDS 原典（PDF）の取得。
#
# **Playwright は使わない。** ibm.com/docs は bot に 403 を返すため（実測: 生ブラウザでも
# "IBM notice: The page you requested cannot be displayed"）、DDS の原典は
# IBM の公開ファイルサーバ public.dhe.ibm.com から PDF で取る。こちらは素の HTTP で届く。
#
# **版が違う。** dhe には systemi の v5r2〜v6r1 しか置かれておらず、7.x は無い。
# したがってこの 2 本は **V6R1** であり、cl/ilerpg カテゴリ（7.4）とは版が異なる。
# 桁割りや主要キーワードは実質変わらないが、**参照するときは版差を意識すること。**
#
# **英語版を採る。** 日本語版も存在するが CID フォントでテキスト抽出ができず、
# 機械的な照合に使えない。原典照合が目的なので英語版を正とする。
set -eu

BASE="https://public.dhe.ibm.com/systems/power/docs/systemi/v6r1/en_US"
HERE=$(cd "$(dirname "$0")" && pwd)
OUT="$HERE/dds"
UA="Mozilla/5.0"

mkdir -p "$OUT"

# rzakc = DDS for display files (DSPF) / rzakd = DDS for printer files (PRTF)
curl -sSfL -A "$UA" -o "$OUT/DDS-DSPF.pdf" "$BASE/rzakc.pdf"
curl -sSfL -A "$UA" -o "$OUT/DDS-PRTF.pdf" "$BASE/rzakd.pdf"

echo "取得しました:"
ls -l "$OUT"
