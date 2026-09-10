# 決定記録

## D1: 罫線・枠の追加/削除に専用の `DdsEdit` を新設しない

- 背景: 罫線・枠をプレビューに描き、UI から配置・削除できるようにする必要がある
  （AC4, AC6）。専用の構造化編集コマンド（`addGridLine`/`addGridBox`/`removeGridShape`）を
  新設する案と、既存の `setKeywords`（全置換の汎用キーワード編集）に乗せる案があった。
- 決定: `setKeywords` に乗せる。core が新設するのは「構造化データ ⇔ キーワード文字列」の
  純粋な変換関数（`ddsGridShapes.ts`）だけで、追加・削除の編集経路自体は増やさない。
- 理由 / 代替案: 専用コマンドを新設すると、同じ様式に複数の罫線がある場合の
  「どれを消すか」を新たに解く必要が生じる（`sourceLine` だけでは同じ行の複数罫線を
  区別できない）。既存のキーワード・チップ削除はこの問題を最初から抱えていない
  （UI が現在の全文を知っており、消したい1件を除いた全文を組み立て直すだけ）。
  新設案は「同じことをする2つの経路」を作ることになり、AGENTS.md
  「同じ概念集合を複数箇所で列挙しない」に反する。
- 影響: `design.md`「方針A」「対象範囲」「振る舞いの詳細」に反映済み。coding は
  `protocol.ts`/`ddsEdit.ts` に新しい型を足さない前提で進める。

## D2: `RenderModel` は `items` を拡張せず `gridLines`/`gridBoxes` を新設する

- 背景: 罫線・枠を描画モデルに載せる方法として、既存の `RenderItem.kind` に
  `"gridLine"|"gridBox"` を足す案と、独立した配列を新設する案があった。
- 決定: 独立した配列（`gridLines: readonly RenderGridLine[]`、
  `gridBoxes: readonly RenderGridBox[]`）を新設する。
- 理由 / 代替案: `RenderItem` は単一の行・桁・長さを前提にした形（`ddsRenderItem.ts:45-48`）
  で、罫線（境界の向きを持つ）・枠（depth/width の2次元）はどちらも当てはまらない。
  既存の `kind` に足すと、`items` を読むすべての消費側（キャンバス描画・一覧・選択処理）が
  未知の `kind` への対処を強いられ、この work と無関係な箇所に波及するリスクがある。
- 影響: `design.md`「方針B」「インターフェース / データ構造」に反映済み。

## D3: PRTF の cm/inch は `RenderModel` の境界より内側で行・桁に変換し尽くす

- 背景: PRTF の `BOX`/`LINE` は cm/inch 単位（research F3）で、DSPF や既存キャンバスの
  行・桁単位と直接噛み合わない。UI 層まで cm を持ち出すか、`RenderModel` に渡す前に
  行・桁へ変換するかの選択があった。
- 決定: `prtfRenderModel.ts` の内部で変換し尽くし、`RenderModel.gridLines`/`gridBoxes` は
  DSPF/PRTF とも行・桁の単位に統一する。
- 理由 / 代替案: 変換に使うロジック（`prtfLayout.ts` の `Cursor.inches`/`lpi`、
  `prtfDensity.ts` の CPI 解決）は既に存在する（research F4）。境界より内側で変換すれば、
  UI（`ui.ts`）はキャンバス座標系だけを扱えばよく、DSPF/PRTF の分岐を持ち込まずに済む
  （既存のドラッグ・矢印キー移動をそのまま流用できる）。
- 影響: `design.md`「方針C」に反映済み。`ddsGridShapes.ts` の PRTF 側関数は
  `PrintDensity` を受け取って変換する形にする。

## D4: `GRDCLR` の消去効果はプレビューでシミュレートしない

- 背景: `GRDCLR` は実行時に既存の罫線・枠を消す動的キーワード。プレビューにその効果を
  反映するかどうかは requirements に明記が無かった（研究で見つかった論点）。
- 決定: シミュレートしない。`GRDCLR` はキーワードとしてはデータ化する（AC1）が、
  静的なプレビューの描画には影響させない。
- 理由 / 代替案: `ERASE` キーワード（`ddsReferences.ts:181` 他）が同種の「実行時の動的効果」を
  持つが、このプレビューは既に「宣言された配置」を描く設計であり `ERASE` の効果を
  シミュレートしていない。同じ理由を `GRDCLR` にも適用するのが一貫している。
  requirements の「対象外」（GRDATR/GRDCLR の作図UIは対象外）とも整合する。
- 影響: `design.md`「方針D」に反映済み。

## D5: `GRDRCD` の許可キーワード制約はバリデーション対象にしない（follow-up）

- 背景: research で `GRDRCD` を発見。このキーワードを持つレコードは許可されるキーワードが
  限定される（`DSPMOD, GRDATR, GRDBOX, GRDCLR, GRDLIN, ...` 以外禁止）という原典の規則がある。
- 決定: 本 work ではこの制約のバリデーションを実装しない。`GRDRCD` はキーワードデータとしては
  反映する（AC1）が、レベル検査・許可キーワード検査には踏み込まない。
- 理由 / 代替案: requirements の受け入れ基準にこの制約の検査は含まれておらず、
  既存のキーワード・レベル検査（`ddsKeywordLevels.ts`）の粒度（file/record/field）を
  超える「あるキーワードの有無に応じて別のキーワード集合を制限する」新種の規則になる。
  スコープを広げず、次のアクションで backlog 候補として記録する。
- 影響: `design.md`「ドメイン固有の考慮」に反映済み。

## D6: 罫線・枠ツールの配置操作は `event.preventDefault()` を必須にする（coding 中に発見・修正）

- 背景: e2e で「配置後は新しく置いた罫線へ焦点が移る」（AC-I4）が再現性なく失敗した。
  コードは正しく対象要素へ `.focus()` していたにもかかわらず、`document.activeElement`
  が `BODY` に戻っていた。
- 決定: `onPointerDown` の罫線・枠ツール分岐（`this.placing !== null` のとき）の先頭で
  `event.preventDefault()` を呼ぶ。
- 理由 / 代替案: ブラウザは「フォーカス不能な要素を押した」既定動作として、
  `pointerdown`/`mousedown` の**既定動作**でフォーカスを `body` へ落とす。
  この既定動作は JS の同期処理（`.focus()` の明示呼び出しを含む）より**後**に効くため、
  `preventDefault()` を呼ばないと、コードが正しく焦点を移した直後にブラウザが
  それを上書きしてしまう——ログでは「フォーカスは一瞬だけ正しく移り、その後 body に
  戻る」ことを確認した（`console.error` で直接観測）。
  既存のフィールド/様式追加（`place()` の field/constant 分岐、`wireAddRecord()`）は
  完了後の焦点先が非同期のダイアログや別コンポーネント（VSCode の `showInputBox` 相当、
  または `<dialog>`）なので、この既定動作と衝突せず**これまで踏んでいなかった**。
  罫線・枠は「クリック直後に、クリックした場所そのものの要素へ焦点を戻す」という
  今回はじめての形だったため表面化した。
- 影響: `src/dds/webview/ui.ts` の `onPointerDown`。同じ罠は今後「クリック直後に
  クリック位置の新しい要素へ焦点を戻す」種類の操作を足すときに再発しうる——
  そのときはこの決定を参照する。
