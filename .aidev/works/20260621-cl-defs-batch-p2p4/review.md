# レビュー記録（aidev-util-batch 実行: P2+P3+P4先頭 計10件）

これは標準パイプラインではなく `aidev-util-batch` の実行記録。issue #43 backlog の P2(5)+P3(4)+P4先頭(1)を
autonomous 生成し、PR #44（feature/issue-43）に追加コミット。

## ラウンド 1（2026-06-21）

対象: SNDMSG/SNDUSRMSG/SNDRPY/RMVMSG/RTVMSG（P2）, CRTDTAARA/CHGDTAARA/RTVDTAARA/DLTDTAARA（P3）, ADDPFM（P4）

### 検証（test 硬ゲート＝原典機械diff、主エージェント直読）

- **構造検証**: 全 `cl/*.json`（50ファイル）が `PrompterDefinition` 適合（`validate-prompter-defs.mjs`）。
- **原典パラメータ集合 diff**: 10件すべてトップレベル・キーワード集合・必須が原典
  `docs/origin/cl/<CMD>.html` と一致（過不足なし）。
  - P2: SNDMSG(6)/SNDUSRMSG(12)/SNDRPY(6)/RMVMSG(6)/RTVMSG(14)
  - P3: CRTDTAARA(13, req=DTAARA/TYPE)/CHGDTAARA(2,req両方)/RTVDTAARA(2,req両方)/DLTDTAARA(1,req)
  - P4: ADDPFM(6, req=FILE/MBR)

### マッピング上の判断（原典準拠）

- 修飾オブジェクト名 → `group[LIB, <name>]`（既存 DLTF/RCVMSG 慣例どおり LIB を先頭）。
- ネスト要素リスト（RMVMSG PGMQ、CHG/RTVDTAARA DTAARA）→ 既存 RCVMSG 同様 **平坦化**して group children に展開。
- 固定選択肢のみ（MSGTYPE/RMV/SHARE/TYPE 等）→ `dropdown`＋`options`（先頭値を default）。
- 固定値＋自由入力の混在（CCSID/AUT/TOUSR/SRCTYPE 等）→ `text`＋help＋`defaultValue`。

### 指摘

- must=0 / should=0 / nit=0。差し戻しなし。

> 既知の制約: F4 実機検証は headless 未実行（PR #44 と同様、ロード可能性＝構造健全性で代理担保）。
