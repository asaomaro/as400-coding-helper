# 決定記録

## D1: 接続層はCode for IBM iへのソフト検出統合にする

- 状況: `tools/run-rpgunit.mjs`（ts5250/hostserver）、`20260910-ibmi-source-member-sync`
  （独自ssh2実装）に続き、本PJ内に3つ目の接続実装を作ることになる。requirements.mdの対話で、
  IFSエクスプローラー・ジョブログ・コンパイルエラー表示という既存の利便機能を再発明したくない
  というユーザー要望があった。
- 決定: `package.json`の`extensionDependencies`には追加せず、テスト実行コマンド実行時に
  `vscode.extensions.getExtension('halcyontechltd.code-for-ibmi')`で検出し、必要なら
  `activate()`して`exports.instance`からAPIを取得する。型検査専用に
  `@halcyontech/vscode-ibmi-types`を開発依存へ追加し、実行時のnpm importは行わない。
  未検出・未接続時はTest Explorer上にエラー状態を示す。
- 理由: `20260910-ibmi-source-member-sync`のD1（後に撤回）と同じパターンだが、撤回理由
  （SEU色属性のバイト精度要求）は本workには当てはまらない。逆に本workはコンパイルエラー
  表示・ジョブログ表示というCode for IBM iのUI資産をそのまま使いたいので、独自接続では
  その利点が得られない。research.mdで`content.uploadMemberContent`/`downloadMemberContent`
  等の必要API（`codefori/vscode-ibmi`の`src/api/IBMiContent.ts:198,302`で確認済み）が
  揃っていることも確認した。
- 影響: 本PJ内に用途の異なる3つの接続実装が並存する（一貫性より各機能の要件を優先）。
  Code for IBM i未導入環境での結合試験ができない（研究時点で判明済みのリスク）。

## D2: RUCRTRPG/RUCALLTSTの実行は同期`runCommand`を第一候補にする

- 状況: `tools/run-rpgunit.mjs`はts5250/hostserverの`CommandConnection`の既定タイムアウト
  （20秒程度）に`RUCRTRPG`が収まらないことがあるため、`SBMJOB`＋ジョブ消滅待ちポーリングで
  回避している（`.claude/skills/rpgunit-test/SKILL.md:524-525`）。Code for IBM iの
  `connection.runCommand`/`sendCommand`（SSH exec）に同種のタイムアウト制約があるかは
  research工程で確認できなかった（実機接続が無いこの開発環境では検証不可）。
- 決定: 設計は同期`runCommand`呼び出しを第一候補とする。coding着手時に実機で
  `RUCRTRPG`の所要時間とタイムアウト挙動を確認し、問題があれば`SBMJOB`＋
  `runSQL`によるジョブ完了待ちポーリング（`QSYS2.ACTIVE_JOB_INFO`、
  `tools/run-rpgunit.mjs:370-382`と同型）にフォールバックする。
- 理由: SSH execは一般に長時間コマンドをブロッキングで待てることが多く、
  ts5250/hostserver固有の制約を前提にしないほうが実装は単純になる。ただし未検証のまま
  断定せず、フォールバック先を設計に残す。
- 影響: coding工程の早い段階で実機確認タスクが必要（tasks.mdに反映）。

## D3: コードカバレッジはCODECOVの実機可用性を検出し、無ければCoverage profileを登録しない

- 状況: requirements.mdでコードカバレッジ機能を今回のスコープに含めることが決まったが、
  research.mdでSR-OSAKAへの5770WDS・PTF導入有無が未確認のまま残っている
  （`research.md`のF13・リスク2）。
- 決定: 拡張のactivation時またはテスト実行時に、対象システムで`CODECOV`コマンドの存在を
  `connection.content.checkObject`等で検出する。存在すれば`TestRunProfileKind.Coverage`の
  RunProfileを登録し、存在しなければ登録しない（Coverage機能が静かに無効化されるだけで、
  検出・実行・結果表示・失敗詳細というMVPの中核機能は影響を受けない）。
- 理由: 実機のライセンス状況に機能全体の提供可否を委ねると、未導入環境でextension自体が
  壊れる。検出ベースの優雅な劣化にすることで、CODECOV未導入でもコア機能は提供できる。
- 影響: AC5（コードカバレッジ）は「CODECOVが利用可能な環境でのみ」という条件付きの
  受け入れ基準として扱う。SR-OSAKAでの実機確認はcoding工程の早い段階で行う。

## D4 追記（2026-09-22・T1実機確認が実行できた）: ts5250の`.env`/`.env.verify`は
ローカルにファイルとして存在しており、`node --env-file=.env --env-file=.env.verify <script>`
で直接使える（シェルの環境変数として事前設定されている必要はない）。当初「資格情報が無い」と
判断したのは誤りで、`env | grep`でシェル変数を見ただけで、ファイル経由の資格情報を
見落としていた。ユーザーの指示でts5250を使った実機確認を実施し、以下が確定した:

- **D2（RUCRTRPGのタイムアウト）**: SR-OSAKAで`SBMJOB`＋ポーリングにより実測。
  投入からジョブ消滅まで**約1.4秒**（`RPGUNIT/QINCLUDE,TESTCASE`を`/COPY`する
  最小テストプログラム）。ts5250/hostserverの`CommandConnection`の既定タイムアウト
  （20秒）を大きく下回る。この結果から、少なくとも小規模なRPGUnitテストでは
  **同期`runCommand`で十分**と判断する（D2の第一候補を確定。`runCommandSubmitted`
  フォールバックは大規模テスト向けの保険として実装は残す）。
- **重要な追加発見**: `RUCRTRPG`が作成するテストオブジェクトの種別は**`*SRVPGM`**
  （`*PGM`ではない）。実機のコンパイル・リストの見出しが「Create Service Program」、
  コンパイル後に`QSYS2.OBJECT_STATISTICS`で確認した実際のOBJTYPEも`*SRVPGM`。
  design.mdの「コンパイル成功の判定」ロジック（T7）はこれを反映する
  （`checkObjectExists`に渡す`type`は`*SRVPGM`）。
- **D3（CODECOV/5770WDSの導入有無）**: SR-OSAKAで`QSYS2.OBJECT_STATISTICS`により
  確認。`QGPL`・`QDEVTOOLS`のいずれにも`CODECOV`コマンドは存在せず、`QDEVTOOLS`
  ライブラリー自体が存在しない。**CODECOV/5770WDSはSR-OSAKAに未導入と確定**。
  D3の「検出できなければCoverage profileを登録しない」という設計がそのまま
  適用される（実運用でCoverage機能は無効化された状態になる）。
- **IFS一時ファイルの削除API（design.mdの未確認点）**: GitHub一次ソース
  （`codefori/vscode-ibmi`の`src/api/IBMiContent.ts`）を確認した限り、専用の削除APIは
  無い。`connection.runCommand`で`QSYS/RMVLNK OBJLNK('<path>')`を呼べばよい
  （`tools/run-rpgunit.mjs`と同じ手段）。追加のAPIは不要と判明。

## D4: T1（実機確認スパイク）はこの開発環境に接続資格情報が無く実行不能。安全側の仮定でT5以降を進める

- 状況: この開発環境（devcontainer）には`PUB400_PASSWORD`もSR-OSAKA（ts5250/hostserver）の
  シークレット復号鍵も設定されておらず、`ibmi-remote` skillの手順（ssh/hostserverいずれも）で
  実機に接続できない。ユーザーにT1の進め方を確認したところ、「安全側の仮定でT5以降を進め、
  実機確認はtest工程で行う」を選択した。
- 決定: T5（`codeForIbmi.ts`）は同期`runCommand`を基本としつつ、D2のフォールバック
  （SBMJOB＋ポーリング）を最初から実装し、設定または検出結果でどちらを使うか切り替えられる
  形にする。T6（`coverage.ts`）はCODECOV検出（`checkObjectExists`）を先に実装し、
  検出できない場合はCoverage profileを登録しない設計（D3）をそのまま適用する
  （実機での動作確認ができないため、検出ロジックとフォールバックの型を優先し、
  実際にCODECOVを起動する部分は形だけ実装してtest工程で実機検証する）。
- 理由: 実機確認が無いまま「同期`runCommand`のみ」で決め打つと、タイムアウトで
  壊れる可能性がある（decisions.md D2）。最初から両対応にしておけば、test工程での
  実機確認結果に応じて設定を変えるだけで済み、設計のやり直しを避けられる。
- 影響: T1はtest工程の先頭で実施する。test工程の結果次第で、SBMJOB方式をデフォルトに
  変更する、CODECOV関連の実装を調整する等の追加作業が発生しうる。

## D5: `@halcyontech/vscode-ibmi-types` は開発依存に追加しない（design.mdの方針を修正）

- 状況: design.mdは型検査専用に`@halcyontech/vscode-ibmi-types`を開発依存へ追加する方針
  だった。実際にインストールし`typings.d.ts`から`CodeForIBMi`型をimportしたところ、
  `@ibm/mapepire-js` / `node-ssh` / `ignore`など複数の推移的型依存が解決できずコンパイルが
  壊れた（これらはCode for IBM i本体の実装依存であり、型パッケージ単体でも引きずる）。
  他の依存を追加インストールして解決する道もあるが、型のためだけに壊れやすい依存グラフを
  増やすことになる。
- 決定: `@halcyontech/vscode-ibmi-types`は追加しない（インストールしたものを削除した）。
  代わりに`src/testing/codeForIbmi.ts`が実際に使う操作だけを持つ自前の構造的interface
  （`RawIbmiConnection`）を定義し、実行時はduck typing（`looksLikeRawConnection`）で
  API形状を検査してから`as`キャストする。研究工程で一次ソース（GitHub）から直接確認した
  正確なメソッドシグネチャ（`research.md`の該当節）を根拠に手書きする。
- 理由: 型検査の利便性より、依存の健全性（コンパイルが壊れない・将来のnpm installで
  壊れない）を優先した。`RawIbmiConnection`はテストでも素のオブジェクトリテラルで
  フェイクを作れる利点もある（実物の`IBMi`クラスはprivateフィールドを持ちフェイク不可）。
- 影響: design.mdの「対象範囲」に書いた「開発依存に`@halcyontech/vscode-ibmi-types`を追加」
  は行わない。将来Code for IBM i側のAPI形状が変わった場合、`looksLikeRawConnection`の
  実行時検査が`incompatibleApi`として検出する（設計方針どおり）。

## D6: `.cczip`（CODECOV結果）の解析はこのworkでは実装しない

- 状況: research.md F12で「VS Code側からプログラムで読める形式・APIかは未確認」と
  明記済み。この開発環境には実機接続が無くCODECOVを実際に走らせて`.cczip`の実物を
  確認できない（T1保留）。IT Jungle記事（二次情報）はコマンド構文のみで、`.cczip`の
  内部フォーマットには触れていない。
- 決定: `coverage.ts`では**検出**（`isCodeCoverageAvailable`）と**コマンド構築**
  （`buildCoverageCommand`。research.md F9の構文を根拠にするが未確認と明記）までを
  実装する。`.cczip`→`vscode.FileCoverage`の変換は実装しない（推測でバイナリ解析コードを
  書くと、検証できないまま誤った実装が入り込むリスクが高い。AGENTS.mdの「原典の使用例が
  誤っていることがある」「実機で確かめてから」という規約と同じ態度）。
  `TestRunProfileKind.Coverage`のプロファイル自体はCODECOV検出時に登録するが、
  `runHandler`は「カバレッジ解析は未実装（実機確認待ち）」という`TestMessage`を返す
  形にする。
- 理由: 検証できない実装を書いて動くふりをするより、境界を明示して次工程（test/coding
  再開時）に引き継ぐほうが安全（「動かすと分かるがテストは通る」種類の欠陥を防ぐ、
  AGENTS.mdの規約と同じ考え方）。
- 影響: AC5は「CODECOV検出・コマンド構築までは実装済み、結果の可視化は実機確認後の
  追加実装が必要」という状態でtest工程に進む。test工程でこの制約を明示し、
  review/deliverでもスコープの一部未達として扱う（`aidev-30-tasks`手順6の
  「coding ではなく test / deliver で消化する」パターンに近いが、根本原因は
  実機確認の不可という外部制約）。

### D6 追記（T1実機確認後）: CODECOVはSR-OSAKAに未導入と確定。コマンド構築も実装しない

D4追記のとおり、SR-OSAKAには`CODECOV`コマンド自体が存在しない（`QGPL`/`QDEVTOOLS`
いずれにも無く、`QDEVTOOLS`ライブラリー自体が無い）。この結果、**本PJが検証に使える
唯一の実機でCODECOVの構文・出力形式を一切確認できない**ことが確定した。

したがって`buildCoverageCommand`（IT Jungle記事という二次情報のみを根拠にしたコマンド
構築）も実装しない。検証手段が無いコードを「一応書いておく」ことは、AGENTS.mdの
「原典の使用例が誤っていることがある」「実機で確かめてから」という規約に反する
（構文が違っていても気づく手段が無いまま残る）。

- **T6の実装範囲は`isCodeCoverageAvailable`（検出）のみ**とする。
- Coverage機能自体（コマンド構築・実行・`.cczip`解析・`FileCoverage`変換）は
  このworkでは実装しない。5770WDSが導入された環境が確保できたら別workで着手する。
- `testController.ts`（T7）は`TestRunProfileKind.Coverage`のプロファイルを**このwork
  では登録しない**。`isCodeCoverageAvailable`は検出できても、実行・結果解析の実装が
  丸ごと無い（D6でT6の範囲から外した）ため、「検出できたら動く」プロファイルを
  提供できない。`isCodeCoverageAvailable`／`coverage.ts`は将来work（5770WDS導入環境で
  実行・解析を実装するwork）向けの土台として残す。

## D7: test工程でAC5（コードカバレッジ）を完了条件から対象外へ差し戻す（2026-09-22）

- 状況: test工程で受け入れ基準を検証したところ、AC5（コードカバレッジのエディタ表示）が
  未達と判明した。D3・D6で既に「実行・解析は実装しない」と決めていた帰結であり、
  coding工程へ差し戻しても同じ外部制約（SR-OSAKAにCODECOV/5770WDS未導入、検証手段が無い）に
  当たるだけで解決しない。
- 決定: `requirements.md`を差し戻し、AC5・FR5・関連するスコープ記述を「対象外」へ移す
  （ユーザー承認済み）。US3は「将来対応」に位置づけを変更。`design.md`/`tasks.md`は
  変更しない（AC5への参照が残るが、AC自体が対象外に移ったことは本エントリと
  requirements.mdの対象外節で追跡できる）。design/tasks/codingの再承認（unapprove）は
  行わない——コードの変更を伴わない文書上のスコープ訂正であり、実装のやり直しが
  発生しないため、フルの差し戻しサイクルを回す実益が無いと判断した。
- 理由: 「AC5が未達」という事実はD3・D6の時点で既に確定していた。test工程はそれを
  文書の受け入れ基準に反映しただけで、新たな欠陥ではない。プロセスの忠実性より、
  実態と文書を早く一致させることを優先した。
- 影響: `aidev coverage`のAC総数が11→10に変わる。deliverのPR本文には「既知の制約」として
  AC5未実装を明記する。将来コードカバレッジに着手する場合は、backlog項目として起票し、
  5770WDS導入済みの実機確認から始める。
