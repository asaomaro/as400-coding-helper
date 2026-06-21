// 原典 HTML 収集の入力リスト（fetch-origin.mjs が読む）。
// YAML パーサ依存を避けるため ESM モジュールで保持する（decisions.md D1 参照）。
//
// version: CL / ilerpg の IBM Documentation 版（7.4）。
// 各 item の保存先は docs/origin/<category>/<name>.html。

export const version = 'ssw_ibm_i_74'; // IBM i 7.4

export const categories = {
  // CL コマンド: base + <name 小文字>.htm。name はファイル名（大文字 CMD）にも使う。
  cl: {
    base: 'https://www.ibm.com/docs/ja/ssw_ibm_i_74/cl/',
    urlFor: (name) => `https://www.ibm.com/docs/ja/ssw_ibm_i_74/cl/${name.toLowerCase()}.htm`,
    items: [
      // ファイル操作
      'CRTPF', 'CRTLF', 'DLTF', 'OVRDBF', 'CPYF', 'CLRPFM', 'RGZPFM', 'CRTSRCPF',
      // オブジェクト / ライブラリー
      'CRTLIB', 'DLTLIB', 'DLTOBJ', 'CRTDUPOBJ', 'CHGOBJD', 'RNMOBJ', 'MOVOBJ', 'ADDLIBLE', 'CHKOBJ',
      // プログラム / ジョブ制御
      'CALL', 'CALLPRC', 'SBMJOB', 'RTVJOBA', 'RTVDTAARA', 'CHGDTAARA', 'CRTDTAARA',
      // CL ロジック / 変数
      'DCL', 'DCLF', 'CHGVAR', 'IF', 'ELSE', 'DOWHILE', 'DOUNTIL', 'DOFOR', 'SELECT', 'RETURN', 'CALLSUBR',
      // メッセージ
      'SNDPGMMSG', 'RCVMSG', 'MONMSG', 'SNDUSRMSG', 'SNDMSG',
      // ファイル I/O（CL内）/ スプール
      'SNDRCVF', 'RCVF', 'SNDF', 'WRKSPLF', 'CPYSPLF', 'OVRPRTF',

      // --- 第2弾: 制御構造の補完（A） ---
      'PGM', 'ENDPGM', 'DO', 'ENDDO', 'ENDSELECT', 'WHEN', 'OTHERWISE', 'SUBR', 'ENDSUBR', 'ITERATE', 'LEAVE', 'GOTO',
      // メッセージ補完（B）
      'RMVMSG', 'RTVMSG', 'SNDRPY',
      // データ域・取得系（C）
      'DLTDTAARA', 'RTVMBRD', 'RTVOBJD', 'RTVSYSVAL', 'DSPOBJD',
      // ファイル / DB（D）
      'OPNQRYF', 'CLOF', 'ALCOBJ', 'DLCOBJ', 'ADDPFM', 'RMVM', 'CHGPF', 'DSPFD', 'DSPFFD',
      // ジョブ制御（E）
      'CHGJOB', 'DLYJOB', 'WRKACTJOB', 'WRKJOB',
      // スプール / 出力（F）
      'DLTSPLF', 'CHGSPLFA', 'HLDSPLF', 'RLSSPLF', 'WRKOUTQ',
      // コンパイル / オブジェクト作成（G）
      'CRTCLPGM', 'CRTBNDCL', 'CRTBNDRPG', 'CRTRPGMOD', 'CRTPGM', 'CRTDSPF', 'CRTPRTF',
      // 保存・復元・権限（H）
      'SAVOBJ', 'RSTOBJ', 'GRTOBJAUT', 'RVKOBJAUT',
    ].map((name) => ({ name })),
  },

  // ILE RPG 固定長仕様書 7 種（concept ページ）。topic 固定 URL。
  ilerpg: {
    items: [
      { name: 'H-SPEC', url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-control',          note: '制御仕様書 (H)' },
      { name: 'F-SPEC', url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-file-description', note: 'ファイル仕様書 (F)' },
      { name: 'D-SPEC', url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-definition',       note: '定義仕様書 (D)' },
      { name: 'I-SPEC', url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-input',            note: '入力仕様 (I)' },
      { name: 'C-SPEC', url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-calculation',      note: '演算仕様書 (C)' },
      { name: 'O-SPEC', url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-output',           note: '出力仕様 (O)' },
      { name: 'P-SPEC', url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-procedure',        note: 'プロシージャー仕様書 (P)' },

      // --- 第3弾: 桁・主要キーワードの詳細サブページ（後続 JSON 化の桁照合用） ---
      // H 制御
      { name: 'H-SPEC-keywords',                url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-control-specification-keywords',                note: 'H: 制御仕様書キーワード' },
      { name: 'H-SPEC-compile-option-keywords', url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-control-specification-compile-option-keywords', note: 'H: コンパイル・オプション・キーワード' },
      // F ファイル
      { name: 'F-SPEC-keywords',                    url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-file-description-keywords',     note: 'F: ファイル記述キーワード' },
      { name: 'F-SPEC-keywords-program-described',  url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-keywords-program-described',    note: 'F: プログラム記述ファイルのキーワード' },
      { name: 'F-SPEC-keywords-externally-described', url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-keywords-externally-described', note: 'F: 外部記述ファイルのキーワード' },
      // D 定義
      { name: 'D-SPEC-keywords',     url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-definition-specification-keywords',              note: 'D: 定義仕様書キーワード' },
      { name: 'D-SPEC-type-summary', url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-summary-according-definition-specification-type', note: 'D: 定義仕様書タイプごとの要約（桁）' },
      // I 入力（桁表）
      { name: 'I-SPEC-record-id-entries', url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-record-identification-entries', note: 'I: レコード識別記入項目（桁）' },
      { name: 'I-SPEC-field-entries',     url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-field-description-entries',     note: 'I: フィールド記述記入項目（桁）' },
      // C 演算（桁表）
      { name: 'C-SPEC-traditional-syntax',       url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-traditional-syntax',        note: 'C: 従来型構文（桁）' },
      { name: 'C-SPEC-extended-factor2-syntax',  url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-extended-factor-2-syntax', note: 'C: 拡張演算項目2構文（桁）' },
      // O 出力（桁表）
      { name: 'O-SPEC-record-id-control-entries', url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-record-identification-control-entries', note: 'O: レコード識別制御記入項目（桁）' },
      { name: 'O-SPEC-field-control-entries',     url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-field-description-control-entries',      note: 'O: フィールド記述制御記入項目（桁）' },
      // P プロシージャー
      { name: 'P-SPEC-keywords', url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-procedure-specification-keywords', note: 'P: プロシージャー仕様書キーワード' },
    ],
  },

  // RPG III(RPG/400) の de-facto 固定長リファレンス（第三者・jaymoseley RPG チュートリアル）。
  // IBM RPG/400 Reference は ibm.com/docs に生 HTML が無く PDF のみ（README/notes 参照）。
  rpg3: {
    base: 'https://www.jaymoseley.com/hercules/rpgtutor/',
    urlFor: (name) => `https://www.jaymoseley.com/hercules/rpgtutor/${name}.htm`,
    items: [
      { name: 'rpg002', note: 'Basic statement types (Header/File/Input/Output)' },
      { name: 'rpg006', note: 'Calculation Specifications' },
      { name: 'rpg007', note: 'Expanded discussion of selected calculation operations' },
      { name: 'rpg008', note: 'RPG Indicators' },
      { name: 'rpg010', note: 'Advanced statement types (Extension/Line Counter)' },
      { name: 'rpg011', note: 'Output Edit Words' },
    ],
  },
};
