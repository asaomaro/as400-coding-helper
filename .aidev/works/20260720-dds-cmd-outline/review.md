# レビュー記録

## ラウンド 1（2026-07-20）

`/code-review high`（マルチエージェント、24 エージェント）＋主エージェントによる再現確認。
22 件の指摘が 10 件の欠陥に集約された。**うち 5 件が新規の `.cmd` アウトラインに集中**。

- [must] `cmdSymbols.ts:259` **子の range が親の range に含まれていない**。QUAL/ELEM を PARM の
  子に付けたが、PARM の range は自分の行しか覆っていない。VSCode の DocumentSymbol containment
  要件違反。主エージェントが `ADDCUST.cmd` で再現確認（4 件の violation）/ 対応: 修正
  - **自分のテストの穴**: `selectionRange ⊆ range` は検査していたが `child.range ⊆ parent.range`
    を検査していなかった。spec で「PARM は子の範囲まで広げない」と書いた判断自体が誤り。
- [must] `cmdSymbols.ts:304` root の range 拡張が終端しか伸ばさず、CMD より前にある文が
  親より前から始まる子になる / 対応: 修正
- [must] `cmdSymbols.ts:240` CMD が 2 つあると 2 つ目が 1 つ目を子として取り込む（兄弟にならない）
  / 対応: 修正
- [must] `cmdSymbols.ts:257` `groups.get(type)` が生の TYPE 文字列で引くため、大小文字や空白の
  違いでグループが黙って外れる。IBM i の名前は大小文字を区別しない / 対応: 修正
- [must] `cmdSymbols.ts:109` 同一ラベル重複時に `current` が最初のグループを指すため、2 つ目の
  ラベル以降の無ラベル文が最初のグループに付き、種別（elem/qual）も誤る / 対応: 修正
- [must] `outlineRegistration.test.ts:103` 「`.dds` の取りこぼし防止」を謳うテストが selector の
  文字列しか見ておらず、`resolveDdsType` が `.dds` に undefined を返すため補完は 0 件のまま。
  **直っていない振る舞いを直ったものとして固定している** / 対応: 修正（限界を明示するテストに変更）
- [should] `fileScope.ts:60` `toGlobPattern` が要素 1 個でも波括弧を出す（`**/*.{cmd}`）。
  単一候補の brace group を展開しない glob 実装がある / 対応: 修正（1 個なら波括弧を付けない）
- [should] `verify-contributes.mjs:58` 合成元 4 配列の再構成に置き換えたため、`TARGET_EXTENSIONS`
  に**直接**書かれた拡張子が検査から静かに落ちる / 対応: 修正（リテラルも拾って合算）
- [should] `ddsLayout.ts:14` `DDS_COLUMNS` が生成物（`dds-keyword-columns.json`）の桁を手写しして
  おり、一致の検査が無い。AGENTS.md の「原典から機械的に決まるものは検査で固定」に反する
  / 対応: 修正（一致を検査するテストを追加）
- [nit] `cmdSymbols.ts:46` `readStatements` が同じ行を最大 3 回読む / 対応: 修正

**判定: coding へ差し戻し。**

### ラウンド 1 の対応（coding 差し戻し後）

10 件すべて対応。**それぞれ、直す前の状態に戻すとテストが落ちることを確認済み**
（AGENTS.md「落ちないテストは何も守っていない」）。

| 指摘 | 対応 | 戻すと |
|---|---|---|
| 子の range が親に含まれない | `expandToChildren`（`outlineTypes.ts`）を追加し、DDS・`.cmd` の両方で最後に適用 | 6 failing |
| root の range 拡張が終端のみ | 上記に置き換え（開始側も子に合わせて広がる） | 同上 |
| CMD が 2 つで入れ子になる | 兄弟として並べる | 1 failing |
| TYPE の大小文字・空白でグループが外れる | `normalizeLabel` で正規化して突き合わせ | 1 failing |
| 同一ラベル重複で種別と所属が混ざる | ラベルごとに必ず新グループを開く。`claimed` を**ラベル文字列ではなくグループ実体**で持つ（ラベルで持つと 2 つ目が消える） | 1 failing |
| `.dds` 補完のテストが虚偽 | テスト名・内容を修正し、**限界を固定するテスト**（`resolveDdsType('.dds') === undefined`）と「アウトラインは `.dds` でも出る」を追加 | — |
| `**/*.{cmd}` の単一 brace | 1 個なら波括弧を付けない | 1 failing |
| `verify-contributes.mjs` がリテラルを拾わない | 合成元＋リテラルの両方を合算 | — |
| `DDS_COLUMNS` の手写しに検査が無い | 生成物（`dds-keyword-columns.json`）との一致検査を追加 | 1 failing |
| `readStatements` の行の読み直し | 1 行 1 回に修正 | — |

**対応の過程で追加のバグを 1 件自力で発見**: `claimed` をラベル文字列で持っていたため、
同名ラベルが 2 つあると 2 つ目が「引き取り済み」と誤判定されて消えていた。
回帰テストで検出し、グループ実体で持つよう修正。

**テストの穴も 1 件塞いだ**: 単一拡張子の glob 形式を固定するテストが無く、
波括弧を戻しても緑のままだった（`extensionsOf` が両形式を解釈するため）。
形式そのものを assert するテストを追加。

### 検証（ラウンド 1 対応後）

- `npm test` … **136 passing / 0 failing**（ラウンド 1 前は 122）
- `npm run verify` … 全 12 検証 OK
- provider を実際の呼び出し形で駆動し、**containment 違反 0 件**を確認
  （`CUST` の range が参照先 QUAL まで伸びて L3-6 になった）
- ソースに NUL バイトが無いことを確認（`cmdSymbols.ts` が binary 扱いされていた件の再発防止）

## ラウンド 2（2026-07-20）

同じ体制で再レビュー（30 エージェント）。**1 回目の修正が新たな欠陥を作っていた**ことが判明。

- [must] `cmdSymbols.ts:268` **空文字の name で実機の VSCode が例外を投げる**。`PARM KWD()` のように
  値が空だと `??` は空文字を通してしまい、`new vscode.DocumentSymbol("")` が
  `name must not be falsy` で throw する。provider が throw するとアウトラインが固まる
  ——このファイル自身のコメントが禁じている状態。**スタブが検証しないためテストが緑だった**
  / 主エージェントが再現確認（`name: ""`）/ 対応: 修正
- [must] `cmdSymbols.ts:327` **1 回目の `expandToChildren` が隣の PARM を飲み込む**。
  ELEM/QUAL をソース末尾にまとめる配置（実務で普通）だと、PARM A の range が
  PARM B の行を覆ってしまい、B の行にカーソルを置くとパンくずが A を指す。
  主エージェントが再現確認（`A L1-4` / `B L2-5`）/ 対応: 修正
  - **1 回目の修正で「包含違反」を「別シンボルへの誤解決」に付け替えていた。**
- [must] `cmdSymbols.ts:279` ELEM の中から参照される QUAL グループが claim されず、
  ルート直下に浮く（`CHGPRTF USRDFNOBJ` 型＝AGENTS.md が名指しする形）/ 対応: 修正
- [must] `cmdSymbols.ts:133` ELEM と QUAL を継続として交換可能に扱っており、
  ELEM グループの直後の無ラベル QUAL が elem 種別で取り込まれる / 対応: 修正
- [must] `cmdSymbols.ts:110` **ラベルだけの行**（`Q1:` を単独行に書く。CL/.cmd で合法）が
  `parseClCommand` で捨てられ、グループが名前を失って PARM に付かない
  / 主エージェントが再現確認 / 対応: 修正
- [should] `.dds` の glob 検査・`verify-contributes.mjs` の spread 検査が、
  集合を丸ごと落としたときに**空振りで通る**（vacuous pass）/ 対応: 修正
- [should] glob が小文字のみで、大文字のメンバー名（IBM i では普通）に一致しない
  / 対応: 判断のうえ対処
- [nit] 行の再読・終端伝播の重複 / 対応: 修正

**判定: coding へ差し戻し（2 回目）。**

### ラウンド 2 の対応

**設計判断の変更（重要）**: `.cmd` の ELEM/QUAL を入れ子にするのは
**参照元の直後に書かれている場合だけ**にした。

理由: VSCode は子の range が親に含まれることを要求するが、グループは参照元と
離れた場所に書ける。離れたグループを子にすると親の range をそこまで伸ばすことになり、
**間にある兄弟の PARM を飲み込む**（カーソル位置から誤ったパラメータが引かれる）。
包含と非重複は両立しない。当初は無条件に入れ子にして包含違反を作り、ラウンド 1 で
無条件に range を伸ばして飲み込みを作った。**隣接時のみ入れ子**が両方を満たす唯一の形。

離れたグループはルート直下に出し、参照元の detail に TYPE の値を残して辿れるようにした。
`ADDCUST.cmd` のような実務的な書き方（グループを参照元の直後に置く）では
従来どおり入れ子になるので、実用上の見え方は変わらない。

| 指摘 | 対応 | 戻すと |
|---|---|---|
| 空 name で実機が throw | `nameOr()` で空文字も空とみなす。**スタブにも実機と同じ検証を入れた**（これが無いと緑のまま通る） | 1 failing |
| range が隣の PARM を飲み込む | 隣接時のみ入れ子（上記） | 2 failing |
| ELEM 内から参照される QUAL が浮く | `memberNode` を再帰させ、要素の下に修飾名を付ける | 上記に含む |
| ELEM/QUAL を交換可能に扱う | 継続はキーワードが一致する場合のみ | 1 failing |
| ラベルだけの行が捨てられる | 次の文のラベルとして持ち越す | 1 failing |
| 検査の空振り | 集合が空でないことを先に固定するテストを追加 | — |
| 大文字のメンバー名に一致しない | glob に大文字の変種を並べる。IBM i のメンバー名は大文字が普通で、`isInScopeUri` は大文字を受けるのに glob だけ受けず、**ルーラーは出るのにアウトラインは出ない**食い違いだった | — |

### 検証（ラウンド 2 対応後）

- `npm test` … **144 passing / 0 failing**
- `npm run verify` … 全 12 検証 OK
- provider 実駆動で containment 違反 0 件、`ADDCUST.cmd` の階層は維持
- レビュー指摘の再現ケース 5 件すべてが解消することを実行して確認

## ラウンド 3（2026-07-20）

**ラウンド 2 の私の修正が、また新たな不整合を作っていた。**

- [must] `fileScope.ts` **大文字 glob 対応が別の食い違いを新設した**。glob にだけ大文字を
  並べたため、`CUSTMST.PF` で「アウトラインと DDS 補完は効くが、F4 とルーラーは効かない」
  状態になった（`package.json` の keybindings は `resourceExtname == .pf` と小文字固定、
  `ruler.ts:114` の glob も小文字のみ）/ 対応: **変更を取り下げ**
- [must] `cmdSymbols.ts` 未参照グループを常に「最後の CMD」に付けるため、CMD が 2 つあると
  2 つ目の range が 1 つ目まで前方に広がり兄弟が重なる / 対応: その位置を含む CMD に付ける
- [must] `cmdSymbols.ts` ラベルの文字集合が IBM i で合法な `$ # @ _` を受けない / 対応: 修正
- [must] `cmdSymbols.ts` `pendingLabel` が無期限に持ち越され、間の行がラベルを横取りする
  / 対応: 直後の行から始まる文にのみ適用
- [must] `cmdSymbols.ts` ラウンド 2 の `memberNode` 再帰が実配置で到達しない / 対応: 下記
- [should] スタブが `selectionRange ⊆ range` を検査しない / 対応: 実機と同じ検査を追加

### 対応の要点

**1. 大文字 glob 対応は取り下げた（スコープ判断）**

本作業の範囲外だった。大小文字の扱いは PJ 全体の課題で、直すなら keybindings・
`ruler.ts`・`fileScope.ts`・`verify-contributes.mjs` を**まとめて揃える**必要がある。
ここだけ直すと機能ごとに挙動が食い違い、かえって悪化する。
既知の限界としてテストに固定し、follow-up に回す。

**2. 「グループ末尾からの隣接」も許そうとして、また兄弟を飲み込んだ**

`CHGPRTF USRDFNOBJ` 型を入れ子にしようと隣接条件を緩めたところ、
`E1: ELEM TYPE(Q1)` の range が L2-5 に伸びて間の兄弟要素（L3）を覆った。
**ラウンド 2 で直したのと同じ欠陥**。緩和は撤回し、厳密に「参照元の文の直後」のみに戻した。
実際の `CHGPRTF USRDFNOBJ` 配置では修飾名がルート直下に出る。限界だが、
嘘の階層や誤解決を出すよりよい。テストで固定した。

**3. 兄弟の重なりも不変条件として検査**

包含だけでは足りず、兄弟が重なるとカーソル位置からどれが引かれるか不定になる。
`assertNoSiblingOverlap` を両テストに追加した。

### 検証（ラウンド 3 対応後）

- `npm test` … **154 passing / 0 failing**
- `npm run verify` … 12/12 OK
- provider 実駆動で**包含違反 0 件・兄弟重なり 0 件**
- 5 件すべて「戻すと落ちる」ことを確認（うち 1 件は最初テストが素通りしたため、
  行隣接を突くケースを足して捕まえた）
