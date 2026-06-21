# 自律判断ログ（autonomous decisions）

## D1: ドッグフード生成（F-SPEC/ILE）をスコープに含める（spec 工程）

- 状況: requirement「対象外」は「個別定義 JSON の実生成は後続 batch、本作業は skill 新設に限る」とした。
  一方、受け入れ基準は「skill 単独で F-SPEC 等を生成・検証できる」を要求している。
- 判断: skill 新設に加え、**機能実証として F-SPEC/ILE を1件だけ生成・原典照合**する（research 申し送り6）。
  これにより受け入れ基準を**抽象的主張でなく実物で**満たし、skill の有効性を de-risk する。
- 影響: 生成は1件（F-SPEC/ILE）に限定。I/O/P（ILE）と rpg3 多仕様は backlog に残し後続 batch へ。
  対象外の趣旨（全数消化はしない）は維持。
- 代替案: skill のみ新設（ドッグフードなし）→ 受け入れ基準の実証が弱く、batch 初回で skill 不備が露見する
  リスク。却下。

## D2: RPG III 原典の非対称を skill 設計に内在化（research F4 を反映）

- 状況: issue #19 は「RPG III リファレンス（#18 で追加）」を前提にしたが、research F4 で**フル RPG III 原典 doc は
  リポジトリに不在**と判明。#18 は C-spec 桁のみ外部参照で照合し、フル doc は先送りだった。
- 判断: skill は dialect 非対称を明示する。ile=ローカル原典直読、rpg3=オンライン原典 Playwright 取得＋主E直読、
  **取得不能時は桁を捏造せず保留**。当面の受け入れ実証は ile に置く。
- 影響: rpg3-spec backlog は当面 C-SPEC のみ消化可能（原典到達が前提）。issue の前提齟齬は review/deliver で言及する。
