# 仕様: プレビューとビジュアルエディタの使い分けを案内する

## 設計方針

**案内の前に、到達できるようにする。** 文書だけ足しても「エディターで開く…」を
知らない利用者には届かない。プレビューが既に持っている**右クリック導線に並べる**
のが最も短い経路で、2 つの器が同じメニューに並ぶこと自体が使い分けの提示になる。

コマンドの登録先は `editorProvider.ts`。**viewType を持つファイルが開く責任も持つ**
（ID を 2 か所に書かない）。

## 対象範囲

- `vscode-extension/src/dds/editorProvider.ts` — コマンド登録
- `vscode-extension/package.json` — `commands` / `menus`
- `docs/origin/verify-contributes.mjs` — 配線の機械検査
- `docs/dds-editor-and-preview.md` — 使い分け（新規）

## インターフェース / データ構造

| コマンド ID | title | 対象 |
|---|---|---|
| `rpgClSupport.openDdsVisualEditor` | `DDS: ビジュアルエディタで開いて編集` | `.dspf` `.mnudds` `.prtf` |
| `rpgClSupport.showDspfPreview` | `画面プレビュー: 表示イメージを見る（読み取り）` | `.dspf` `.mnudds` |
| `rpgClSupport.showPrtfPreview` | `帳票プレビュー: 印刷イメージを見る（読み取り）` | `.prtf` |

開き方は `vscode.openWith`（VSCode 組み込み）に `DDS_EDITOR_VIEW_TYPE` を渡す。

## 振る舞いの詳細

- 対象外のファイルで実行したら、プレビューと**同じ形**で案内を出して何もしない
  （`resolveDdsType` が `DDS-DSPF` / `DDS-PRTF` のどちらでもない場合）。
- 判定は `resolveDdsType` に委ねる。拡張子の集合をこのファイルに書かない。
- メニューの並び順は `navigation@1`（プレビュー）→ `navigation@2`（エディタ）。
  **読む方を先に置く**——確認だけの用途の方が頻度が高く、編集はテキストエディタを
  置き換える分だけ後戻りが重い。

## ドメイン固有の考慮

AGENTS.md「追加したリソースは到達可能になって初めて完了」。今回はまさにその死蔵で、
**エディタ本体は動くのに開く手段が無かった**。同じことを繰り返さないよう、
`verify-contributes.mjs` に「`customEditors[].selector` の `filenamePattern` と
メニューの `when` が一致する」検査を足す。

`when` の拡張子は `resolveDdsType` 由来（DSPF ∪ PRTF）であり、**カスタムエディタの
`selector` とも一致していなければならない**。真実源が 2 つあるので、
**両方に対して**照合する。

## エラー処理 / 異常系

- アクティブなテキストエディタが無い / 対象外 → `showInformationMessage` で案内。例外にしない。
- 既にビジュアルエディタで開いている文書に対して実行 → `vscode.openWith` がその
  エディタを前面に出すだけ（`supportsMultipleEditorsPerDocument: false`）。

## 受け入れ基準との対応

- AC1: `commands` ＋ `editor/context` にエディタの項目を足す
- AC2: `verify-contributes.mjs` に `EDITOR_MENUS` の検査を足し、`selector` とも突き合わせる
- AC3: 3 つの `title` に「（読み取り）」「編集」を入れる
- AC4: `docs/dds-editor-and-preview.md` に対比表を書く
