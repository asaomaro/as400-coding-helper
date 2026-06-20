# 決定記録

## D1: ルーラー文字列は per-instance `renderOptions.before` で差し込み、CSS 注入で浮かせる

- 背景: spec は「decoration の `before` contentText ＋ CSS で上に浮かせる」方針。だが `DecorationType` の
  `contentText` は型定義時に固定で、フォーカス行ごとに異なるルーラー文字列を出せない。
- 決定: `DecorationType` は空で生成し、`editor.setDecorations` の各 `DecorationOptions.renderOptions.before`
  に `contentText` と `textDecoration`（CSS 注入）を行単位で指定する。浮かせは
  `textDecoration: "none; position: absolute; top: <em>; ..."` で実現。
- 理由 / 代替案: 固定 `contentText` の DecorationType を多数作る案は破棄（行内容で文字列が変わるため非現実的）。
  per-instance renderOptions は VSCode 標準機能で、動的テキスト＋CSS 注入を 1 つの型で両立できる。
- 影響: spec の描画機構の意図は満たす。`top` の実値（`-2.4em`/`-1.2em`）は暫定で、直上行への重なり具合は
  test 工程で実機調整が必要（spec の未確定点に対応）。

## D2: `cNewOpcodes` 判定は positionResolver から export せず ruler.ts に同規約で実装

- 背景: spec は「C の新旧判定を既存 `cNewOpcodes` と同じロジックで共有」。当該ロジックは
  `positionResolver.ts` 内の private `getCNewOpcodes()`。
- 決定: ruler.ts 側に同一規約（同じ既定集合 ＋ 設定 `rpgClSupport.cNewOpcodes` の取り込み）の
  `getCNewOpcodes()` を実装し、既定値と設定キーを揃えて挙動を一致させた。
- 理由 / 代替案: positionResolver の export 化（共通化）も検討したが、既存の prompter 系挙動に触れる
  リスクを避け、ルーラーは `resolvePosition` に依存しない独自判定（spec 方針: H/F/O/P まで拡張）を貫くため、
  小さな同規約実装を選択。設定キー・既定値が単一の真実（package.json の default）に紐づくため実害は小さい。
- 影響: 将来 cNewOpcodes の既定集合を変える場合、2 箇所（positionResolver / ruler）の同期が必要。
  review で「共通ヘルパへの抽出」を follow-up 候補として検討してよい。

## D3: コメント行の判定は 7 桁目（index 6）の `*` を採用

- 背景: spec 本文は「コメント行（6 桁目 `*`）」と記載。一方 RPG 固定フォーマットの実コメントは 7 桁目の `*`
  であり、既存 `rpgTabNavigation.ts` も `charAt(6) === "*"`（7 桁目）でコメントを扱う。
- 決定: ruler.ts の種別判定では 7 桁目（index 6）が `*` の行を「種別なし（目盛り段のみ）」とした。
  併せて 6 桁目（index 5）が H/F/D/C/O/P 以外なら従来どおり種別なしになるため、`*` を 6 桁目に置く
  ケースも自然に除外される。
- 理由 / 代替案: 実フォーマットと既存コード規約に合わせる方が正確。spec の「6 桁目」は記述の揺れと判断。
- 影響: spec の文言と実装で桁番号の表現が異なる。review/spec 更新時に文言を実装に合わせて修正する余地あり。
