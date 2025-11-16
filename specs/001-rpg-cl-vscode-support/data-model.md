# Data Model – RPG/CL Development Support Tool for VS Code

**Branch**: `001-rpg-cl-vscode-support`  
**Spec**: `specs/001-rpg-cl-vscode-support/spec.md`  
**Plan**: `specs/001-rpg-cl-vscode-support/plan.md`

## Overview

本データモデルは、VS Code拡張機能として実装される RPG/CL 開発支援ツールの内部で扱う主なエンティティと、その関係・バリデーションルールを整理したものです。  
IBM i 連携は初期リリースではローカル編集支援が中心となるため、ここでは主にローカルのソースファイル・プロンプター定義・診断結果を対象とします。

---

## Entities

### 1. SourceDocument（RPG/CLソースファイル）

**Purpose**: VS Codeで開かれているRPG（固定長フォーマット）またはCLソースを表現する。

- `id`: string – VS CodeのURIなど、文書を一意に識別できるID
- `language`: `"rpg-fixed"` \| `"cl"` – 対象言語種別
- `path`: string – ワークスペースからの相対パスまたは絶対パス
- `encoding`: string – 文字コード（例: `"UTF-8"`, `"Shift_JIS"`）
- `lines`: string[] – 行ごとの内容
- `lastModified`: Date – 最終更新日時

**Validation / Rules**:
- RPGの場合、固定長フォーマットの各列（仕様コード、演算子、フィールド名など）が定義された範囲内に収まっているかをチェック可能。  
- RPGソース内にフリーフォーマット構文が含まれる場合、その範囲はサポート対象外として診断に渡される。  
- CLの場合、各行が有効なCLコマンド構造になっているかを構文解析で確認可能。

---

### 2. WorkspaceConfig（ワークスペース／プロジェクト設定）

**Purpose**: ワークスペース単位で適用されるRPG/CL向けのルールやプロンプター設定を表現する。

- `workspaceRoot`: string – ワークスペースルートパス
- `rules`: {
  - `namingConventions`?: object – 命名規約に関するルール
  - `warningLevel`?: `"info"` \| `"warning"` \| `"error"`
  - `maxLineLength`?: number
  }
- `jsonDefinitionPaths`: {
  - `rpgSpecPath`: string – RPG仕様書JSONのパス
  - `clCommandsPath`: string – CLコマンド定義JSONのパス
  }

**Validation / Rules**:
- JSON定義ファイルパスは存在確認が可能な形式で指定されること。  
- ルール設定は拡張機能内で解釈可能な値に制限される。

---

### 3. PrompterDefinition（プロンプター定義）

**Purpose**: RPG仕様やCLコマンドに基づく、プロンプター画面の構造をJSONで表現したもの。

- `keyword`: string – キーワード名（RPG仕様キーワード、CLコマンド名など）
- `description`: string – キーワードの説明（ヘルプ表示用）
- `parameters`: `ParameterDefinition[]` – パラメータ一覧

**Validation / Rules**:
- `keyword` は拡張内で一意であることが望ましい。  
- `parameters` 配列は空であってはならない（プロンプターとして意味を持たないため）。

---

### 4. ParameterDefinition（パラメータ定義）

**Purpose**: プロンプター内の単一パラメータ、またはグループ化されたパラメータの要素を表現する。

- `name`: string – パラメータ名
- `description`: string – パラメータの説明（ヘルプ表示用）
- `inputType`: `"text"` \| `"dropdown"` \| `"number"` \| `"group"`
- `required`: boolean – 必須入力かどうか
- `defaultValue`?: string
- `attributes`?: {
  - `characterSet`?: `"alpha"` \| `"alnum"` \| `"upper"` \| `"any"`
  - `numericOnly`?: boolean
  - `minLength`?: number
  - `maxLength`?: number
}
- `length`?: number – 桁数（最大桁数など）
- `placeholder`?: string – プレースホルダー
- `maxOccurrences`?: number – 最大パラメータ数（2以上で複数値指定可）
- `visibleByDefault`?: boolean – 初期状態で表示するかどうか
- `options`?: { `label`: string; `value`: string }[] – ドロップダウンリストの選択肢
- `children`?: `ParameterDefinition[]` – グループ化されたパラメータの場合のネストされたパラメータ一覧

**Validation / Rules**:
- `required = true` の場合、入力値が空であってはならず、UI上のラベルに「*」が付与される。  
- `numericOnly = true` の場合、入力は数値のみ許可される。  
- `characterSet` が指定されている場合、その文字セットに合致しない文字はエラーとする。  
- `maxLength` または `length` が指定されている場合、それを超える入力はエラーとする。  
- `maxOccurrences` が 1 より大きい場合、ユーザーはUIから行（またはカード）を追加・削除できる。  
- `visibleByDefault = false` のパラメータは初期状態では非表示だが、UI操作により表示切り替えが可能であること。  
- 入力値が既に存在するパラメータは非表示にできない（常に表示状態を維持する）。

---

### 5. PrompterSession（プロンプターセッション）

**Purpose**: F4キー押下時に起動するプロンプターの一時的な状態を表現する。

- `documentId`: string – 対象 SourceDocument のID
- `position`: { `line`: number; `column`: number } – F4押下時のカーソル位置
- `keyword`: string – 対象となるキーワード（RPG仕様/CLコマンド）
- `parameterValues`: {
  - `parameterName`: string
  - `occurrenceIndex`: number
  - `value`: string
}[]
- `isOpen`: boolean – プロンプターが開いているかどうか

**Validation / Rules**:
- セッション開始時にカーソル位置とキーワードが保存され、プロンプターを閉じた際には元のカーソル位置に戻される。  
- `parameterValues` は `PrompterDefinition.parameters` と整合している必要がある（存在しないパラメータ名を持たない）。

---

### 6. Diagnostic（構文チェック結果）

**Purpose**: RPG/CLソースに対する構文チェックやルール検証の結果を表現する。

- `documentId`: string – 対象 SourceDocument のID
- `severity`: `"info"` \| `"warning"` \| `"error"`
- `message`: string – ユーザー向けエラーメッセージ
- `range`: {
  - `start`: { `line`: number; `column`: number }
  - `end`: { `line`: number; `column`: number }
}
- `code`?: string – エラーコード（任意）

**Validation / Rules**:
- 拡張機能は `Diagnostic` 情報を VS Code の診断機構に連携し、エディタ上で下線やツールチップとして表示する。  
- プロンプターのバリデーションエラーも同様の構造で扱い、入力エリア付近にツールチップとして表示される。

---

## Relationships

- **SourceDocument ↔ Diagnostic**: 1対多  
  - 1つのソースファイルに対して複数の診断結果が紐づく。  
- **PrompterDefinition ↔ ParameterDefinition**: 1対多  
  - 1つのキーワードに複数のパラメータ定義が存在する。  
- **ParameterDefinition（親） ↔ ParameterDefinition（子）**: 1対多  
  - グループ化されたパラメータは `children` によってネストされる。  
- **SourceDocument ↔ PrompterSession**: 1対0..1  
  - 1つのソースドキュメントに対して、同時に1つのプロンプターセッションが紐づく想定。  
- **WorkspaceConfig ↔ PrompterDefinition**: 1対多  
  - ワークスペース設定は、RPG仕様JSONとCLコマンドJSONへのパスを通じて複数のプロンプター定義を読み込む。

