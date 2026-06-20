# 決定記録

## D1: 新拡張子を既存言語に「同居させない」（review差し戻しによる spec 判断の見直し）

- 背景: spec では `.dds/.dspf/.prtf` を `rpg-fixed`、`.cmd` を `cl` 言語に同居させる方針だった。
- review 指摘: 言語同居により languageId が `rpg-fixed`/`cl` になり、
  - `.cmd` に CL 診断(`parseClDocument`)が走り誤診断の恐れ
  - `.dds/.dspf/.prtf` に RPG 編集キーバインド(コメントトグル/タブナビ)が作動
  という、表示系拡張という本 issue の意図を超えた副作用が生じる。
- 決定: `.dds/.dspf/.prtf/.cmd` は言語登録しない。`.rpg` のみ `rpg-fixed` に同居
  （本物の固定長RPGのため RPG 機能の適用が妥当）。
- アクティベーション: `activationEvents` に `onStartupFinished` を追加し、
  拡張機能起動後は `isInScopeDocument`(拡張子ベース)で表示系(SOSI/ルーラー)のみ全7拡張子に適用する。
- 影響: spec.md「2. アクティベーションの担保」の言語割り当て表を本決定で更新する。
  受け入れ基準(isInScope が7拡張子で真)は不変。
