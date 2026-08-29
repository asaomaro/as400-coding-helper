# タスク: RPGUnit を SR-OSAKA に導入する

- [x] T1: 配布元を特定し SAVF を取得、サイズと sha256 を記録する
      対象: `tools-400/irpgunit`（GitHub）/ SourceForge の Update Site zip / 根拠: research F1
- [x] T2: SAVF を IFS 経由で `ASAOLIB/RPGUNIT` に載せる（依存: T1）
      対象: `IfsConnection.writeFile` → `CPYFRMSTMF … CVTDTA(*NONE)` / 根拠: research A1
- [x] T3: `DSPSAVF` で `Release level` と中身を確認し、入れる版を確定する（依存: T2）
      対象: `DSPSAVF FILE(ASAOLIB/…) OUTPUT(*PRINT)` ＋ スプール読み / 根拠: research F3, A3
- [x] T4: `RSTLIB SAVLIB(RPGUNIT)` で導入する（依存: T3）
      対象: 展開先は既定名 `RPGUNIT`（`ASAOLIB` に混ぜない）/ 根拠: spec 設計方針 2
- [x] T5: 固定長と `**free`（対照）を `CRTRPGMOD` に通す（依存: T4）
      対象: `ASAOLIB/QUNITSRC` の `FIXTST` / `FREETST` / 根拠: research F6
- [x] T6: `RUCRTRPG` でテスト・サービスプログラムを作る（依存: T5）
      対象: CL driver `ASAOLIB/RUDRV2`（`RPGUNIT/` で修飾・`SBMJOB INQMSGRPY(*DFT)`）/ 根拠: research リスク
- [x] T7: `RUCALLTST` で実行し、出力形式を採取する（依存: T6）
      対象: スプール `RPGUNIT`（`readSpooledPages`）/ 根拠: research A3
- [x] T8: 片付け（IFS の作業ファイル・使えない v6 の SAVF・残ジョブ）（依存: T7）
      対象: `RMVLNK` / `DLTF ASAOLIB/RPGUNIT6` / `ENDJOB` / 根拠: plan「リスク」
