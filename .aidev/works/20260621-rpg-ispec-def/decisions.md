# 自律判断ログ（autonomous decisions）

## D1: プロンプター配線の修正をスコープに含める（ユーザー承認済み）

- 背景: `positionResolver.ts`（F4 プロンプター／タブナビの種別判定）は **D/C しか扱っておらず**、
  H/F/I/O/P の定義 JSON があっても F4 で開けない（ruler 表示とは別経路）。既存 H-SPEC.json・先行 F-SPEC.json も
  同じ配線漏れ状態で、過去のバックログ消化が JSON 作成のみだったため**死蔵定義が蓄積**していた。
- 決定: backlog 消化時にユーザーへ確認し、「JSON＋配線も実施」を選択。**根本原因は ruler.ts と positionResolver.ts で
  spec 分類が重複（コピペ）し、ruler だけに F/O/P が追加されてドリフトしたこと**。共有モジュール
  `prompter/specClassifier.ts` に分類（`classifyRpgSpecKeyword` / `getCNewOpcodes`）を**単一化**し、両者から呼ぶ。
  副産物として H/F/I/O/P が F4 プロンプター／タブナビに配線され、既存 F/H の死蔵も解消。
- 理由 / 代替案: 定義のみ作成（前例どおり）は死蔵を増やすだけで価値が低い。targeted な case 追加でも直るが、
  重複は残り再発する。単一化が再発防止として最善。
- 影響: `ruler.ts` / `positionResolver.ts` から重複ロジック（`classifyCSpec`/`getCNewOpcodes`）を削除し共有へ。
  挙動: ruler は dialect 非依存（従来どおり）、prompter は dialect 依存で C 新旧判定（従来どおり）。
  この共有配線は I-SPEC コミットに含める（O/P は JSON 追加のみで自動的に配線済みになる）。

## D2: I/O 仕様の代表行＝レコード行・required は控えめ

- 背景: I/O 仕様は1レコードに複数行種（レコード識別行／フィールド記述行）を持つ。原典の桁位置表は両者を併記。
- 決定: 原典の桁位置表を1:1で写像しつつ、1定義が両行種に供されるため **`required` は付けない**（行種により空欄になる欄が
  必須だと他方の行で破綻するため）。rpg-spec-def skill の「I/O 行種の扱い」に整合。help に前提を明記。
- 影響: I-SPEC は全欄 required:false。O-SPEC も同様（P-SPEC は単一行種のため PROCNAME/BEGINEND を required:true）。
