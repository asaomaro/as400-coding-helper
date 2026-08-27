#!/usr/bin/env python3
"""検査用の様式 `RENDER1.dspf` を生成する。

**桁を手で数えない。** 過去に `N50` を 8 桁目でなく 9 桁目に置いて実機で落ちている。
桁は `DDS_COLUMNS`（`src/core/ddsLayout.ts`）と同じものをここに写している。

実行: python3 .aidev/works/20260827-dds-render-golden/verify/make-render-fixture.py
出力: vscode-extension/test/golden/RENDER1.dspf
"""
import pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parents[4]
OUT = ROOT / "vscode-extension/test/golden/RENDER1.dspf"


def put(line, col, value):
    a = list(line)
    for i, ch in enumerate(value):
        a[col - 1 + i] = ch
    return "".join(a)


def guard(line):
    # **80 桁を超えたら止める。** 実機は 81 桁目以降を読まず CPD7508 で落ちる。
    if len(line.rstrip()) > 80:
        sys.exit(f"80 桁を超えた: |{line}|")
    return line.rstrip()


def dds(*, cond=None, nametype=None, name=None, length=None,
        dtype=None, dec=None, usage=None, row=None, col=None, kw=None):
    l = put(" " * 80, 6, "A")
    if cond is not None:     l = put(l, 7, cond)                    # 7-16 条件付け
    if nametype is not None: l = put(l, 17, nametype)               # 17 名前タイプ
    if name is not None:     l = put(l, 19, name)                   # 19-28 名前
    if length is not None:   l = put(l, 30, str(length).rjust(5))   # 30-34 長さ（右寄せ）
    if dtype is not None:    l = put(l, 35, dtype)                  # 35 データ・タイプ
    if dec is not None:      l = put(l, 36, str(dec).rjust(2))      # 36-37 小数
    if usage is not None:    l = put(l, 38, usage)                  # 38 使用目的
    if row is not None:      l = put(l, 39, str(row).rjust(3))      # 39-41 行
    if col is not None:      l = put(l, 42, str(col).rjust(3))      # 42-44 桁
    if kw is not None:       l = put(l, 45, kw)                     # 45-80 機能
    return guard(l)


lines = [
    "     A* 描画モデルと実機の画面を突き合わせるための様式。",
    "     A* 生成物なので手で直さない（verify/make-render-fixture.py を直す）。",
    dds(kw="DSPSIZ(24 80 *DS3)"),
    dds(nametype="R", name="RENDERR", kw="CA03(03)"),
    # --- 定数: DBCS / 混在 / 半角。SO/SI が桁を食うのでここが最もずれる -----
    dds(row=2,  col=4,  kw="'顧客保守'"),
    dds(row=2,  col=20, kw="'CUSTOMER MAINT'"),
    dds(row=4,  col=4,  kw="'コードNO'"),
    dds(row=4,  col=30, kw="'区分A'"),
    # --- フィールド: 用途 3 種（B=入出力 / I=入力 / O=出力）----------------
    dds(row=6,  col=4,  kw="'NAME'"),
    dds(name="NAME",   length=20, dtype="A", usage="B", row=6,  col=12),
    dds(row=8,  col=4,  kw="'CODE'"),
    dds(name="CODE",   length=6,  dtype="S", dec=0, usage="I", row=8,  col=12),
    dds(row=10, col=4,  kw="'AMOUNT'"),
    dds(name="AMOUNT", length=9,  dtype="S", dec=2, usage="O", row=10, col=12),
    # --- 見え方（色・反転表示・下線・非表示）--------------------------------
    dds(row=12, col=4,  kw="'RED' COLOR(RED)"),
    dds(row=12, col=12, kw="'REVERSE' DSPATR(RI)"),
    dds(row=12, col=24, kw="'UNDER' DSPATR(UL)"),
    dds(row=12, col=34, kw="'WHITE' COLOR(WHT)"),
    dds(row=14, col=4,  kw="'HIDE' DSPATR(ND)"),
    dds(row=14, col=12, kw="'全角赤' COLOR(RED)"),
    # --- 数字のみ（Y）× 小数点あり。**入力欄は小数点の分 1 桁広い** ---------
    dds(row=18, col=4,  kw="'RATE'"),
    dds(name="RATE",   length=6,  dtype="Y", dec=2, usage="B", row=18, col=12),
    # --- 条件付け。標識 50 はオフのまま出すので**画面に無い**はず -----------
    dds(cond="  50", row=16, col=4, kw="'COND50'"),
    # --- 端（24 行目・右端）------------------------------------------------
    dds(row=22, col=74, kw="'EDGE'"),
    dds(row=24, col=4,  kw="'F3=EXIT'"),
]

OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"wrote {OUT} ({len(lines)} 行)")
