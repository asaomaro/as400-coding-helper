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
    // コンテンツ API 用のトピックパス。指定があればブラウザ描画ではなく API で取得する
    // （速く確実で、表がそのまま残る）。lang は取得側で切り替える。
    topicFor: (name) => `ssw_ibm_i_74/cl/${name.toLowerCase()}.htm`,
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
      'SNDPGMMSG', 'RCVMSG', 'MONMSG', 'SNDUSRMSG', 'SNDMSG', 'SNDBRKMSG',
      // 待ち行列（メッセージ / ジョブ / 出力 / データ）
      'CRTMSGQ', 'CHGMSGQ', 'DLTMSGQ', 'WRKMSGQ', 'CLRMSGQ', 'DSPMSG',
      'CRTJOBQ', 'CHGJOBQ', 'DLTJOBQ', 'WRKJOBQ', 'CLRJOBQ', 'HLDJOBQ', 'RLSJOBQ',
      'DLTOUTQ', 'CLROUTQ', 'HLDOUTQ', 'RLSOUTQ',
      'CRTDTAQ', 'DLTDTAQ', 'WRKDTAQ',
      // クエリー管理 / Query/400 / SQL
      'STRQMQRY', 'STRQMPRC', 'CRTQMQRY', 'CRTQMFORM', 'DLTQMQRY', 'DLTQMFORM',
      'WRKQMQRY', 'WRKQMFORM', 'RTVQMQRY', 'RTVQMFORM',
      'RUNQRY', 'WRKQRY', 'DLTQRY', 'STRSQL', 'RUNSQLSTM',
      // クライアント連携
      'STRPCO', 'STRPCCMD',
      // ファイル I/O（CL内）/ スプール
      'SNDRCVF', 'RCVF', 'SNDF', 'WRKSPLF', 'CPYSPLF', 'OVRPRTF',

      // --- 第2弾: 制御構造の補完（A） ---
      'PGM', 'ENDPGM', 'DO', 'ENDDO', 'ENDSELECT', 'WHEN', 'OTHERWISE', 'SUBR', 'ENDSUBR', 'ITERATE', 'LEAVE', 'GOTO',
      // メッセージ補完（B）
      'RMVMSG', 'RTVMSG', 'SNDRPY',
      // データ域・取得系（C）
      'DLTDTAARA', 'RTVMBRD', 'RTVOBJD', 'RTVSYSVAL', 'DSPOBJD',
      // ファイル / DB（D）
      'OPNQRYF', 'CLOF', 'ALCOBJ', 'DLCOBJ', 'ADDPFM', 'ADDLFM', 'RMVM', 'CHGPF', 'DSPFD', 'DSPFFD',
      // ジョブ制御（E）
      'CHGJOB', 'DLYJOB', 'WRKACTJOB', 'WRKJOB',
      // スプール / 出力（F）
      'DLTSPLF', 'CHGSPLFA', 'HLDSPLF', 'RLSSPLF', 'WRKOUTQ',
      // コンパイル / オブジェクト作成（G）
      'CRTCLPGM', 'CRTBNDCL', 'CRTBNDRPG', 'CRTRPGMOD', 'CRTPGM', 'CRTDSPF', 'CRTPRTF',
      // 保存・復元・権限（H）
      'SAVOBJ', 'RSTOBJ', 'GRTOBJAUT', 'RVKOBJAUT',

      // --- 第3弾: 開発・運用でよく使うもの（実機に存在することを確認済み） ---
      // コンパイル / オブジェクト作成
      'CRTCLMOD', 'CRTSRVPGM', 'UPDPGM', 'UPDSRVPGM',
      // ソース操作
      'CPYSRCF', 'DSPPFM', 'RNMM', 'CHGPFM', 'RTVCLSRC',
      // ライブラリー・リスト
      'RMVLIBLE', 'CHGLIBL', 'CHGCURLIB', 'CLRLIB',
      // 一時変更
      'DLTOVR', 'OVRDSPF',
      // SQL
      'RUNSQLSTM', 'RUNSQL',
      // デバッグ
      'STRDBG', 'ENDDBG',
      // ジョブ
      'WRKOBJ', 'DSPJOBLOG', 'ENDJOB', 'CHGCMDDFT', 'WRKSBMJOB', 'WRKUSRJOB', 'HLDJOB', 'RLSJOB',
      // スプール / ライター
      'CHGOUTQ', 'CRTOUTQ', 'WRKWTR', 'STRPRTWTR',
      // 保存・復元
      'SAVLIB', 'SAVCHGOBJ',
      // 保管復元（DDM 経由で他システムへ）
      'SAVRSTLIB', 'SAVRSTOBJ',
      // 権限
      'CHGOBJOWN', 'DSPOBJAUT', 'EDTOBJAUT',
      // 構成・システム値
      'WRKCFGSTS', 'VRYCFG', 'DSPSYSVAL',

      // コマンド定義ステートメント（.cmd ソースに書く文。CL コマンドではないが
      // 原典の書式も構文も CL コマンドと同じなので同じ経路で扱う）
      'CMD', 'PARM', 'ELEM', 'QUAL', 'DEP', 'PMTCTL',
      // 第4弾: コンパイル / オブジェクト作成の残り
      'ADDBNDDIRE', 'ADDMSGD', 'CHGMSGD', 'CRTBNDDIR', 'CRTCBLMOD', 'CRTCBLPGM', 'CRTCMD', 'CRTDTADCT',
      'CRTMNU', 'CRTMSGF', 'CRTPNLGRP', 'CRTRPGPGM', 'CRTRPTPGM', 'CRTSBSD', 'CRTSQLCBL', 'CRTSQLCBLI',
      'CRTSQLPKG', 'CRTSQLRPG', 'CRTSQLRPGI', 'RMVBNDDIRE', 'RMVMSGD',
      // 第4弾: サブシステム関連
      'ADDAJE', 'ADDCMNE', 'ADDJOBQE', 'ADDPJE', 'ADDRTGE', 'ADDWSE', 'CHGAJE', 'CHGJOBQE',
      'CHGPJE', 'CHGRTGE', 'CHGSBSD', 'CHGWSE', 'DLTSBSD', 'DSPSBSD', 'ENDSBS', 'RMVAJE',
      'RMVCMNE', 'RMVJOBQE', 'RMVPJE', 'RMVRTGE', 'RMVWSE', 'STRSBS', 'WRKSBS', 'WRKSBSD',
      'WRKSBSJOB',
      // 第4弾: 既存対象物の動詞の穴埋め
      'CHGDSPF', 'CHGJOBD', 'CHGLF', 'CHGLIB', 'CHGPGM', 'CHGPRTF', 'CHGSRCPF', 'CHGWTR',
      'DLTMOD', 'DLTPGM', 'DLTSRVPGM', 'DSPDTAARA', 'DSPF', 'DSPJOB', 'DSPJOBD', 'DSPLIB',
      'DSPMOD', 'DSPPGM', 'DSPSPLF', 'DSPSRVPGM', 'EDTF', 'ENDWTR', 'HLDWTR', 'RLSWTR',
      'WRKDTAARA', 'WRKF', 'WRKJOBD', 'WRKLIB', 'WRKMOD', 'WRKPGM', 'WRKSRVPGM',
    ].map((name) => ({ name })),
  },

  // ILE RPG 固定長仕様書 7 種（concept ページ）。topic 固定 URL。
  // DDS（データ記述仕様）。1-44 桁の定位置項目は用途ごとに意味が異なるため、
  // 物理/論理・表示装置・印刷装置をそれぞれ取得する。
  dds: {
    items: [
      { name: 'PF-LF-POSITIONAL', topic: 'ssw_ibm_i_74/rzakb/rzakbmstlfpos.htm', note: '物理/論理ファイルの定位置項目 (1-44桁)' },
      { name: 'DSPF-POSITIONAL',  topic: 'ssw_ibm_i_74/rzakc/rzakcmstpsnent.htm', note: '表示装置ファイルの定位置項目 (1-44桁)' },
      { name: 'PRTF-POSITIONAL',  topic: 'ssw_ibm_i_74/rzakd/rzakdmstposy1.htm',  note: '印刷装置ファイルの定位置項目 (1-44桁)' },
      { name: 'PF-LF-KEYWORDS',   topic: 'ssw_ibm_i_74/rzakb/rzakbmstlfkeyw.htm', note: '物理/論理ファイルのキーワード項目 (45-80桁)' },
      { name: 'DSPF-KEYWORDS',    topic: 'ssw_ibm_i_74/rzakc/rzakcmstkeyent.htm', note: '表示装置ファイルのキーワード項目 (45-80桁)' },
      { name: 'PRTF-KEYWORDS',    topic: 'ssw_ibm_i_74/rzakd/rzakdmstprkey.htm',  note: '印刷装置ファイルのキーワード項目 (45-80桁)' },
      // 編集コードの早見表。EDTCDE の印刷幅を計算するのに要る。
      // 5-9 は実機の *EDTD オブジェクト（ユーザー定義）なのでオフラインでは解決できない。
      { name: 'PRTF-EDITCODES', topic: 'ssw_ibm_i_74/rzakd/os400edits.htm', note: '印刷装置ファイル内の IBM i 編集コード' },
      // 定位置項目の各欄の詳細（有効な値の一覧がここにある）
      { name: 'FIELD-PF-lfseq', topic: 'ssw_ibm_i_74/rzakb/lfseq.htm', note: '物理ファイルおよび論理ファイルの順序番号 (1 から 5 桁目)' },
      { name: 'FIELD-PF-lfform', topic: 'ssw_ibm_i_74/rzakb/lfform.htm', note: '物理ファイルおよび論理ファイルの仕様書タイプ (6 桁目)' },
      { name: 'FIELD-PF-lfcmmt', topic: 'ssw_ibm_i_74/rzakb/lfcmmt.htm', note: '物理ファイルおよび論理ファイルの注記 (7 桁目)' },
      { name: 'FIELD-PF-lfcond', topic: 'ssw_ibm_i_74/rzakb/lfcond.htm', note: '物理ファイルおよび論理ファイルの条件付け (8 から 16 桁目)' },
      { name: 'FIELD-PF-lftype', topic: 'ssw_ibm_i_74/rzakb/lftype.htm', note: '物理ファイルおよび論理ファイルの名前または仕様のタイプ (17 桁目)' },
      { name: 'FIELD-PF-lftrsrvd', topic: 'ssw_ibm_i_74/rzakb/lftrsrvd.htm', note: '物理ファイルおよび論理ファイル用に予約済み (18 桁目)' },
      { name: 'FIELD-PF-lfname', topic: 'ssw_ibm_i_74/rzakb/lfname.htm', note: '物理ファイルおよび論理ファイルの名前 (19 から 28 桁目)' },
      { name: 'FIELD-PF-pfrefer', topic: 'ssw_ibm_i_74/rzakb/pfrefer.htm', note: '物理ファイルおよび論理ファイルの参照 (29 桁目)' },
      { name: 'FIELD-PF-lleng', topic: 'ssw_ibm_i_74/rzakb/lleng.htm', note: '物理ファイルおよび論理ファイルの長さ (30 から 34 桁目)' },
      { name: 'FIELD-PF-ldata', topic: 'ssw_ibm_i_74/rzakb/ldata.htm', note: '物理ファイルおよび論理ファイルのデータ・タイプ (35 桁目)' },
      { name: 'FIELD-PF-ldec', topic: 'ssw_ibm_i_74/rzakb/ldec.htm', note: '物理ファイルおよび論理ファイルの小数点以下桁数 (36 および 37 桁目)' },
      { name: 'FIELD-PF-lfusg', topic: 'ssw_ibm_i_74/rzakb/lfusg.htm', note: '物理ファイルおよび論理ファイルの使用目的 (38 桁目)' },
      { name: 'FIELD-PF-lfloc', topic: 'ssw_ibm_i_74/rzakb/lfloc.htm', note: '物理ファイルおよび論理ファイルの位置 (39 から 44 桁目)' },
      { name: 'FIELD-DSPF-dfseq', topic: 'ssw_ibm_i_74/rzakc/dfseq.htm', note: '表示装置ファイルの定位置項目 (1 - 7 桁目)' },
      { name: 'FIELD-DSPF-pos716', topic: 'ssw_ibm_i_74/rzakc/pos716.htm', note: '表示装置ファイルの条件付け (7 - 16 桁目)' },
      { name: 'FIELD-DSPF-pos17', topic: 'ssw_ibm_i_74/rzakc/pos17.htm', note: '表示装置ファイルの名前または仕様のタイプ (17 桁目)' },
      { name: 'FIELD-DSPF-pos18', topic: 'ssw_ibm_i_74/rzakc/pos18.htm', note: '表示装置ファイル用に予約済み (18 桁目)' },
      { name: 'FIELD-DSPF-pos1928', topic: 'ssw_ibm_i_74/rzakc/pos1928.htm', note: '表示装置ファイルの名前 (19 - 28 桁目)' },
      { name: 'FIELD-DSPF-rzakcmstpos29', topic: 'ssw_ibm_i_74/rzakc/rzakcmstpos29.htm', note: '表示装置ファイルの参照 (29 桁目)' },
      { name: 'FIELD-DSPF-pos3034', topic: 'ssw_ibm_i_74/rzakc/pos3034.htm', note: '表示装置ファイルの桁数 (30 - 34 桁目)' },
      { name: 'FIELD-DSPF-rzakcmstdfdt', topic: 'ssw_ibm_i_74/rzakc/rzakcmstdfdt.htm', note: '表示装置ファイルのデータ・タイプおよびキーボード・シフト (35 桁目)' },
      { name: 'FIELD-DSPF-pos3637', topic: 'ssw_ibm_i_74/rzakc/pos3637.htm', note: '表示装置ファイルの小数点以下の桁数 (36 - 37 桁目)' },
      { name: 'FIELD-DSPF-pos38', topic: 'ssw_ibm_i_74/rzakc/pos38.htm', note: '表示装置ファイルの使用目的 (38 桁目)' },
      { name: 'FIELD-DSPF-pos3944', topic: 'ssw_ibm_i_74/rzakc/pos3944.htm', note: '表示装置ファイルの位置 (39 - 44 桁目)' },
      { name: 'FIELD-DSPF-rzakcmstkeyent', topic: 'ssw_ibm_i_74/rzakc/rzakcmstkeyent.htm', note: '表示装置ファイルの DDS キーワード項目 (45 - 80 桁目)' },
      { name: 'FIELD-PRTF-rzakdmstprkey', topic: 'ssw_ibm_i_74/rzakd/rzakdmstprkey.htm', note: '印刷装置ファイルのキーワード項目 (45 から 80 桁目)' },
      { name: 'FIELD-PRTF-prtseq', topic: 'ssw_ibm_i_74/rzakd/prtseq.htm', note: '順序番号 (印刷装置ファイルの 1 から 5 桁目)' },
      { name: 'FIELD-PRTF-prtform', topic: 'ssw_ibm_i_74/rzakd/prtform.htm', note: '用紙タイプ (印刷装置ファイルの 6 桁目)' },
      { name: 'FIELD-PRTF-prtcmmt', topic: 'ssw_ibm_i_74/rzakd/prtcmmt.htm', note: '注記 (印刷装置ファイルの 7 桁目)' },
      { name: 'FIELD-PRTF-prtcond', topic: 'ssw_ibm_i_74/rzakd/prtcond.htm', note: '条件 (印刷装置ファイルの 7 から 16 桁目)' },
      { name: 'FIELD-PRTF-prttype', topic: 'ssw_ibm_i_74/rzakd/prttype.htm', note: '名前または仕様のタイプ (印刷装置ファイルの 17 桁目)' },
      { name: 'FIELD-PRTF-prtrsrvd', topic: 'ssw_ibm_i_74/rzakd/prtrsrvd.htm', note: '予約済み (印刷装置ファイルの 18 桁目)' },
      { name: 'FIELD-PRTF-prname', topic: 'ssw_ibm_i_74/rzakd/prname.htm', note: '名前 (印刷装置ファイルの 19 から 28 桁目)' },
      { name: 'FIELD-PRTF-prref', topic: 'ssw_ibm_i_74/rzakd/prref.htm', note: '参照 (印刷装置ファイルの 29 桁目)' },
      { name: 'FIELD-PRTF-prtlen', topic: 'ssw_ibm_i_74/rzakd/prtlen.htm', note: '桁数 (印刷装置ファイルの 30 から 34 桁目)' },
      { name: 'FIELD-PRTF-prtdata', topic: 'ssw_ibm_i_74/rzakd/prtdata.htm', note: 'データ・タイプ (印刷装置ファイルの 35 桁目)' },
      { name: 'FIELD-PRTF-prtdec', topic: 'ssw_ibm_i_74/rzakd/prtdec.htm', note: '小数点以下の桁数 (印刷装置ファイルの 36 から 37 桁目)' },
      { name: 'FIELD-PRTF-prtuse', topic: 'ssw_ibm_i_74/rzakd/prtuse.htm', note: '使用目的 (印刷装置ファイルの 38 桁目)' },
      { name: 'FIELD-PRTF-posy44', topic: 'ssw_ibm_i_74/rzakd/posy44.htm', note: '位置 (印刷装置ファイルの 39 から 44 桁目)' },
    ],
  },

  ilerpg: {
    items: [
      { name: 'H-SPEC', topic: 'ssw_ibm_i_74/rzasd/conspe9.htm', url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-control',          note: '制御仕様書 (H)' },
      { name: 'F-SPEC', topic: 'ssw_ibm_i_74/rzasd/filedes.htm', url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-file-description', note: 'ファイル仕様書 (F)' },
      { name: 'D-SPEC', topic: 'ssw_ibm_i_74/rzasd/dspec9.htm', url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-definition',       note: '定義仕様書 (D)' },
      { name: 'I-SPEC', topic: 'ssw_ibm_i_74/rzasd/inspec.htm', url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-input',            note: '入力仕様 (I)' },
      { name: 'C-SPEC', topic: 'ssw_ibm_i_74/rzasd/calcul.htm', url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-calculation',      note: '演算仕様書 (C)' },
      { name: 'O-SPEC', topic: 'ssw_ibm_i_74/rzasd/outspe9.htm', url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-output',           note: '出力仕様 (O)' },
      { name: 'P-SPEC', topic: 'ssw_ibm_i_74/rzasd/pspec9.htm', url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-procedure',        note: 'プロシージャー仕様書 (P)' },

      // --- 第3弾: 桁・主要キーワードの詳細サブページ（後続 JSON 化の桁照合用） ---
      // H 制御
      { name: 'H-SPEC-keywords', topic: 'ssw_ibm_i_74/rzasd/cskw.htm',                url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-control-specification-keywords',                note: 'H: 制御仕様書キーワード' },
      { name: 'H-SPEC-compile-option-keywords', topic: 'ssw_ibm_i_74/rzasd/cscokw.htm', url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-control-specification-compile-option-keywords', note: 'H: コンパイル・オプション・キーワード' },
      // F ファイル
      { name: 'F-SPEC-keywords', topic: 'ssw_ibm_i_74/rzasd/fdkw.htm',                    url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-file-description-keywords',     note: 'F: ファイル記述キーワード' },
      { name: 'F-SPEC-keywords-program-described', topic: 'ssw_ibm_i_74/rzasd/fdspk.htm',  url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-keywords-program-described',    note: 'F: プログラム記述ファイルのキーワード' },
      { name: 'F-SPEC-keywords-externally-described', topic: 'ssw_ibm_i_74/rzasd/fdsek.htm', url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-keywords-externally-described', note: 'F: 外部記述ファイルのキーワード' },
      // D 定義
      { name: 'D-SPEC-keywords', topic: 'ssw_ibm_i_74/rzasd/dskwd.htm',     url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-definition-specification-keywords',              note: 'D: 定義仕様書キーワード' },
      { name: 'D-SPEC-type-summary', topic: 'ssw_ibm_i_74/rzasd/dsumtb.htm', url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-summary-according-definition-specification-type', note: 'D: 定義仕様書タイプごとの要約（桁）' },
      // I 入力（桁表）
      { name: 'I-SPEC-record-id-entries', topic: 'ssw_ibm_i_74/rzasd/iri.htm', url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-record-identification-entries', note: 'I: レコード識別記入項目（桁）' },
      { name: 'I-SPEC-field-entries', topic: 'ssw_ibm_i_74/rzasd/ifd.htm',     url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-field-description-entries',     note: 'I: フィールド記述記入項目（桁）' },
      // C 演算（桁表）
      { name: 'I-SPEC-entries-external', topic: 'ssw_ibm_i_74/rzasd/ief.htm', note: 'I: 外部記述ファイルの記入項目（桁）' },
      { name: 'O-SPEC-entries-external', topic: 'ssw_ibm_i_74/rzasd/oe.htm',  note: 'O: 外部記述ファイルの記入項目（桁）' },
      { name: 'I-SPEC-rec-external', topic: 'ssw_ibm_i_74/rzasd/ier.htm', note: 'I: 外部記述 レコード識別記入項目（桁）' },
      { name: 'I-SPEC-fld-external', topic: 'ssw_ibm_i_74/rzasd/ied.htm', note: 'I: 外部記述 フィールド記述記入項目（桁）' },
      { name: 'O-SPEC-rec-external', topic: 'ssw_ibm_i_74/rzasd/reciden.htm', note: 'O: 外部記述 レコード識別・制御記入項目（桁）' },
      { name: 'O-SPEC-fld-external', topic: 'ssw_ibm_i_74/rzasd/oef.htm', note: 'O: 外部記述 フィールド記述・制御記入項目（桁）' },
      // 桁ごとの説明ページ（英語版の欄の説明の出所）
      { name: 'POS-c6', topic: 'ssw_ibm_i_74/rzasd/c6.htm', note: 'Position 6 (Form Type)' },
      { name: 'POS-c78', topic: 'ssw_ibm_i_74/rzasd/c78.htm', note: 'Positions 7-8 (Control Level)' },
      { name: 'POS-c911', topic: 'ssw_ibm_i_74/rzasd/c911.htm', note: 'Positions 9-11 (Indicators)' },
      { name: 'POS-c1225', topic: 'ssw_ibm_i_74/rzasd/c1225.htm', note: 'Positions 12-25 (Factor 1)' },
      { name: 'POS-c2635', topic: 'ssw_ibm_i_74/rzasd/c2635.htm', note: 'Positions 26-35 (Operation and Extender)' },
      { name: 'POS-c3649', topic: 'ssw_ibm_i_74/rzasd/c3649.htm', note: 'Positions 36-49 (Factor 2)' },
      { name: 'POS-c3680', topic: 'ssw_ibm_i_74/rzasd/c3680.htm', note: 'Positions 36-80 (Extended Factor 2)' },
      { name: 'POS-c5063', topic: 'ssw_ibm_i_74/rzasd/c5063.htm', note: 'Positions 50-63 (Result Field)' },
      { name: 'POS-c6468', topic: 'ssw_ibm_i_74/rzasd/c6468.htm', note: 'Positions 64-68 (Field Length)' },
      { name: 'POS-c6970', topic: 'ssw_ibm_i_74/rzasd/c6970.htm', note: 'Positions 69-70 (Decimal Positions)' },
      { name: 'POS-c7176', topic: 'ssw_ibm_i_74/rzasd/c7176.htm', note: 'Positions 71-76 (Resulting Indicators)' },
      { name: 'POS-cx1225', topic: 'ssw_ibm_i_74/rzasd/cx1225.htm', note: 'Positions 12-25 (Factor 1)' },
      { name: 'POS-cx2635', topic: 'ssw_ibm_i_74/rzasd/cx2635.htm', note: 'Positions 26-35 (Operation and Extender)' },
      { name: 'POS-cx78', topic: 'ssw_ibm_i_74/rzasd/cx78.htm', note: 'Positions 7-8 (Control Level)' },
      { name: 'POS-cx911', topic: 'ssw_ibm_i_74/rzasd/cx911.htm', note: 'Positions 9-11 (Indicators)' },
      { name: 'POS-f6', topic: 'ssw_ibm_i_74/rzasd/f6.htm', note: 'Position 6 (Form Type)' },
      { name: 'POS-ajfds07', topic: 'ssw_ibm_i_74/rzasd/ajfds07.htm', note: 'Positions 7-16 (File Name)' },
      { name: 'POS-f17', topic: 'ssw_ibm_i_74/rzasd/f17.htm', note: 'Position 17 (File Type)' },
      { name: 'POS-f18', topic: 'ssw_ibm_i_74/rzasd/f18.htm', note: 'Position 18 (File Designation)' },
      { name: 'POS-poenfil', topic: 'ssw_ibm_i_74/rzasd/poenfil.htm', note: 'Position 19 (End of File)' },
      { name: 'POS-pofiad', topic: 'ssw_ibm_i_74/rzasd/pofiad.htm', note: 'Position 20 (File Addition)' },
      { name: 'POS-posseq', topic: 'ssw_ibm_i_74/rzasd/posseq.htm', note: 'Position 21 (Sequence)' },
      { name: 'POS-f22', topic: 'ssw_ibm_i_74/rzasd/f22.htm', note: 'Position 22 (File Format)' },
      { name: 'POS-f2327', topic: 'ssw_ibm_i_74/rzasd/f2327.htm', note: 'Positions 23-27 (Record Length)' },
      { name: 'POS-f28', topic: 'ssw_ibm_i_74/rzasd/f28.htm', note: 'Position 28 (Limits Processing)' },
      { name: 'POS-f2933', topic: 'ssw_ibm_i_74/rzasd/f2933.htm', note: 'Positions 29-33 (Length of Key or Record' },
      { name: 'POS-f34', topic: 'ssw_ibm_i_74/rzasd/f34.htm', note: 'Position 34 (Record Address Type)' },
      { name: 'POS-f35', topic: 'ssw_ibm_i_74/rzasd/f35.htm', note: 'Position 35 (File Organization)' },
      { name: 'POS-f3642', topic: 'ssw_ibm_i_74/rzasd/f3642.htm', note: 'Positions 36-42 (Device)' },
      { name: 'POS-fpos43', topic: 'ssw_ibm_i_74/rzasd/fpos43.htm', note: 'Position 43 (Reserved)' },
      { name: 'POS-f4480', topic: 'ssw_ibm_i_74/rzasd/f4480.htm', note: 'Positions 44-80 (Keywords)' },
      { name: 'POS-d6', topic: 'ssw_ibm_i_74/rzasd/d6.htm', note: 'Position 6 (Form Type)' },
      { name: 'POS-d721', topic: 'ssw_ibm_i_74/rzasd/d721.htm', note: 'Positions 7-21 (Name)' },
      { name: 'POS-d22', topic: 'ssw_ibm_i_74/rzasd/d22.htm', note: 'Position 22 (External Description)' },
      { name: 'POS-d23', topic: 'ssw_ibm_i_74/rzasd/d23.htm', note: 'Position 23 (Type of Data Structure)' },
      { name: 'POS-d2425', topic: 'ssw_ibm_i_74/rzasd/d2425.htm', note: 'Positions 24-25 (Definition Type)' },
      { name: 'POS-d2632', topic: 'ssw_ibm_i_74/rzasd/d2632.htm', note: 'Positions 26-32 (From Position)' },
      { name: 'POS-d3339', topic: 'ssw_ibm_i_74/rzasd/d3339.htm', note: 'Positions 33-39 (To Position / Length)' },
      { name: 'POS-d40', topic: 'ssw_ibm_i_74/rzasd/d40.htm', note: 'Position 40 (Internal Data Type)' },
      { name: 'POS-d4142', topic: 'ssw_ibm_i_74/rzasd/d4142.htm', note: 'Positions 41-42 (Decimal Positions)' },
      { name: 'POS-d43', topic: 'ssw_ibm_i_74/rzasd/d43.htm', note: 'Position 43 (Reserved)' },
      { name: 'POS-d4480', topic: 'ssw_ibm_i_74/rzasd/d4480.htm', note: 'Positions 44-80 (Keywords)' },
      { name: 'POS-p6', topic: 'ssw_ibm_i_74/rzasd/p6.htm', note: 'Position 6 (Form Type)' },
      { name: 'POS-p721', topic: 'ssw_ibm_i_74/rzasd/p721.htm', note: 'Positions 7-21 (Name)' },
      { name: 'POS-p24', topic: 'ssw_ibm_i_74/rzasd/p24.htm', note: 'Position 24 (Begin/End Procedure)' },
      { name: 'POS-p4480', topic: 'ssw_ibm_i_74/rzasd/p4480.htm', note: 'Positions 44-80 (Keywords)' },
      { name: 'POS-iri716', topic: 'ssw_ibm_i_74/rzasd/iri716.htm', note: 'Positions 7-16 (File Name)' },
      { name: 'POS-iri1618', topic: 'ssw_ibm_i_74/rzasd/iri1618.htm', note: 'Positions 16-18 (Logical Relationship)' },
      { name: 'POS-iri1718', topic: 'ssw_ibm_i_74/rzasd/iri1718.htm', note: 'Positions 17-18 (Sequence)' },
      { name: 'POS-iri19', topic: 'ssw_ibm_i_74/rzasd/iri19.htm', note: 'Position 19 (Number)' },
      { name: 'POS-iri20', topic: 'ssw_ibm_i_74/rzasd/iri20.htm', note: 'Position 20 (Option)' },
      { name: 'POS-iri2122', topic: 'ssw_ibm_i_74/rzasd/iri2122.htm', note: 'Positions 21-22 (Record Identifying Indi' },
      { name: 'POS-iri2346', topic: 'ssw_ibm_i_74/rzasd/iri2346.htm', note: 'Positions 23-46 (Record Identification C' },
      { name: 'POS-iri2343', topic: 'ssw_ibm_i_74/rzasd/iri2343.htm', note: 'Positions 23-27, 31-35, and 39-43 (Posit' },
      { name: 'POS-irinot', topic: 'ssw_ibm_i_74/rzasd/irinot.htm', note: 'Positions 28, 36, and 44 (Not)' },
      { name: 'POS-iri2945', topic: 'ssw_ibm_i_74/rzasd/iri2945.htm', note: 'Positions 29, 37, and 45 (Code Part)' },
      { name: 'POS-iri3046', topic: 'ssw_ibm_i_74/rzasd/iri3046.htm', note: 'Positions 30, 38, and 46 (Character)' },
      { name: 'POS-ifd730', topic: 'ssw_ibm_i_74/rzasd/ifd730.htm', note: 'Positions 7-30 (Reserved)' },
      { name: 'POS-ifd3134', topic: 'ssw_ibm_i_74/rzasd/ifd3134.htm', note: 'Positions 31-34 (Data Attributes - Exter' },
      { name: 'POS-ifd35', topic: 'ssw_ibm_i_74/rzasd/ifd35.htm', note: 'Position 35 (Date/Time Separator)' },
      { name: 'POS-ifd36', topic: 'ssw_ibm_i_74/rzasd/ifd36.htm', note: 'Position 36 (Data Format)' },
      { name: 'POS-ifd3746', topic: 'ssw_ibm_i_74/rzasd/ifd3746.htm', note: 'Positions 37-46 (Field Location)' },
      { name: 'POS-ifd4748', topic: 'ssw_ibm_i_74/rzasd/ifd4748.htm', note: 'Positions 47-48 (Decimal Positions)' },
      { name: 'POS-ifd4962', topic: 'ssw_ibm_i_74/rzasd/ifd4962.htm', note: 'Positions 49-62 (Field Name)' },
      { name: 'POS-ifd6364', topic: 'ssw_ibm_i_74/rzasd/ifd6364.htm', note: 'Positions 63-64 (Control Level)' },
      { name: 'POS-posimat', topic: 'ssw_ibm_i_74/rzasd/posimat.htm', note: 'Positions 65-66 (Matching Fields)' },
      { name: 'POS-ifd6768', topic: 'ssw_ibm_i_74/rzasd/ifd6768.htm', note: 'Positions 67-68 (Field Record Relation)' },
      { name: 'POS-fidoug', topic: 'ssw_ibm_i_74/rzasd/fidoug.htm', note: 'Positions 69-74 (Field Indicators - Prog' },
      { name: 'POS-ifd6', topic: 'ssw_ibm_i_74/rzasd/ifd6.htm', note: 'Position 6 (Form Type)' },
      { name: 'POS-ier716', topic: 'ssw_ibm_i_74/rzasd/ier716.htm', note: 'Positions 7-16 (Record Name)' },
      { name: 'POS-ier1720', topic: 'ssw_ibm_i_74/rzasd/ier1720.htm', note: 'Positions 17-20 (Reserved)' },
      { name: 'POS-ier2122', topic: 'ssw_ibm_i_74/rzasd/ier2122.htm', note: 'Positions 21-22 (Record Identifying Indi' },
      { name: 'POS-ier2380', topic: 'ssw_ibm_i_74/rzasd/ier2380.htm', note: 'Positions 23-80 (Reserved)' },
      { name: 'POS-ied720', topic: 'ssw_ibm_i_74/rzasd/ied720.htm', note: 'Positions 7-20 (Reserved)' },
      { name: 'POS-ied2130', topic: 'ssw_ibm_i_74/rzasd/ied2130.htm', note: 'Positions 21-30 (External Field Name)' },
      { name: 'POS-ied3148', topic: 'ssw_ibm_i_74/rzasd/ied3148.htm', note: 'Positions 31-48 (Reserved)' },
      { name: 'POS-ied4962', topic: 'ssw_ibm_i_74/rzasd/ied4962.htm', note: 'Positions 49-62 (Field Name)' },
      { name: 'POS-ied6364', topic: 'ssw_ibm_i_74/rzasd/ied6364.htm', note: 'Positions 63-64 (Control Level)' },
      { name: 'POS-posmat', topic: 'ssw_ibm_i_74/rzasd/posmat.htm', note: 'Positions 65-66 (Matching Fields)' },
      { name: 'POS-ied6768', topic: 'ssw_ibm_i_74/rzasd/ied6768.htm', note: 'Positions 67-68 (Reserved)' },
      { name: 'POS-ied6974', topic: 'ssw_ibm_i_74/rzasd/ied6974.htm', note: 'Positions 69-74 (Field Indicators - Exte' },
      { name: 'POS-ied7580', topic: 'ssw_ibm_i_74/rzasd/ied7580.htm', note: 'Positions 75-80 (Reserved)' },
      { name: 'POS-ajout07', topic: 'ssw_ibm_i_74/rzasd/ajout07.htm', note: 'Positions 7-16 (File Name)' },
      { name: 'POS-posiand', topic: 'ssw_ibm_i_74/rzasd/posiand.htm', note: 'Positions 16-18 (Program-described Logic' },
      { name: 'POS-postype', topic: 'ssw_ibm_i_74/rzasd/postype.htm', note: 'Position 17 (Type – Program-Described Fi' },
      { name: 'POS-posadd', topic: 'ssw_ibm_i_74/rzasd/posadd.htm', note: 'Positions 18-20 (Record Addition/Deletio' },
      { name: 'POS-posista', topic: 'ssw_ibm_i_74/rzasd/posista.htm', note: 'Position 18 (Fetch Overflow/Release)' },
      { name: 'POS-posiout', topic: 'ssw_ibm_i_74/rzasd/posiout.htm', note: 'Positions 21-29 (File Record ID Indicato' },
      { name: 'POS-posexc', topic: 'ssw_ibm_i_74/rzasd/posexc.htm', note: 'Positions 30-39 (EXCEPT Name)' },
      { name: 'POS-opr4051', topic: 'ssw_ibm_i_74/rzasd/opr4051.htm', note: 'Positions 40-51 (Space and Skip)' },
      { name: 'POS-opr4042', topic: 'ssw_ibm_i_74/rzasd/opr4042.htm', note: 'Positions 40-42 (Space Before)' },
      { name: 'POS-opr4345', topic: 'ssw_ibm_i_74/rzasd/opr4345.htm', note: 'Positions 43-45 (Space After)' },
      { name: 'POS-opr4648', topic: 'ssw_ibm_i_74/rzasd/opr4648.htm', note: 'Positions 46-48 (Skip Before)' },
      { name: 'POS-opr4951', topic: 'ssw_ibm_i_74/rzasd/opr4951.htm', note: 'Positions 49-51 (Skip After)' },
      { name: 'POS-posout', topic: 'ssw_ibm_i_74/rzasd/posout.htm', note: 'Positions 21-29 (File Field Description ' },
      { name: 'POS-opf3043', topic: 'ssw_ibm_i_74/rzasd/opf3043.htm', note: 'Positions 30-43 (Field Name)' },
      { name: 'POS-opf44', topic: 'ssw_ibm_i_74/rzasd/opf44.htm', note: 'Position 44 (Edit Codes)' },
      { name: 'POS-posblan', topic: 'ssw_ibm_i_74/rzasd/posblan.htm', note: 'Position 45 (Blank After)' },
      { name: 'POS-opf4751', topic: 'ssw_ibm_i_74/rzasd/opf4751.htm', note: 'Positions 47-51 (End Position)' },
      { name: 'POS-opf52', topic: 'ssw_ibm_i_74/rzasd/opf52.htm', note: 'Position 52 (Data Format)' },
      { name: 'POS-opf5380', topic: 'ssw_ibm_i_74/rzasd/opf5380.htm', note: 'Positions 53-80 (Constant, Edit Word, Da' },
      { name: 'POS-pos720', topic: 'ssw_ibm_i_74/rzasd/pos720.htm', note: 'Positions 7-20 (Reserved)' },
      { name: 'POS-oer716', topic: 'ssw_ibm_i_74/rzasd/oer716.htm', note: 'Positions 7-16 (Record Name)' },
      { name: 'POS-posand', topic: 'ssw_ibm_i_74/rzasd/posand.htm', note: 'Positions 16-18 (External Logical Relati' },
      { name: 'POS-oer17', topic: 'ssw_ibm_i_74/rzasd/oer17.htm', note: 'Position 17 (Type – Externally Described' },
      { name: 'POS-oer18', topic: 'ssw_ibm_i_74/rzasd/oer18.htm', note: 'Position 18 (Release)' },
      { name: 'POS-oer1820', topic: 'ssw_ibm_i_74/rzasd/oer1820.htm', note: 'Positions 18-20 (Record Addition)' },
      { name: 'POS-oer2129', topic: 'ssw_ibm_i_74/rzasd/oer2129.htm', note: 'Positions 21-29 (External File Record ID' },
      { name: 'POS-oer3039', topic: 'ssw_ibm_i_74/rzasd/oer3039.htm', note: 'Positions 30-39 (EXCEPT Name)' },
      { name: 'POS-oef2129', topic: 'ssw_ibm_i_74/rzasd/oef2129.htm', note: 'Positions 21-29 (External Field Descript' },
      { name: 'POS-oef3043', topic: 'ssw_ibm_i_74/rzasd/oef3043.htm', note: 'Positions 30-43 (Field Name)' },
      { name: 'POS-oef45', topic: 'ssw_ibm_i_74/rzasd/oef45.htm', note: 'Position 45 (Blank After)' },
      { name: 'C-SPEC-traditional-syntax', topic: 'ssw_ibm_i_74/rzasd/calss.htm',       url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-traditional-syntax',        note: 'C: 従来型構文（桁）' },
      { name: 'C-SPEC-extended-factor2-syntax', topic: 'ssw_ibm_i_74/rzasd/calx.htm',  url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-extended-factor-2-syntax', note: 'C: 拡張演算項目2構文（桁）' },
      // O 出力（桁表）
      { name: 'O-SPEC-record-id-control-entries', topic: 'ssw_ibm_i_74/rzasd/reidco.htm', url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-record-identification-control-entries', note: 'O: レコード識別制御記入項目（桁）' },
      { name: 'O-SPEC-field-control-entries', topic: 'ssw_ibm_i_74/rzasd/opf.htm',     url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-field-description-control-entries',      note: 'O: フィールド記述制御記入項目（桁）' },
      // P プロシージャー
      { name: 'P-SPEC-keywords', topic: 'ssw_ibm_i_74/rzasd/pskwd.htm', url: 'https://www.ibm.com/docs/ja/i/7.4.0?topic=specifications-procedure-specification-keywords', note: 'P: プロシージャー仕様書キーワード' },

      // --- 第4弾: 固定形式の桁レイアウト（各仕様書の全桁を列挙しているトピック） ---
      // 従来これらを取得しておらず、桁位置を原典照合できない状態だった。
      { name: 'H-SPEC-layout', topic: 'ssw_ibm_i_74/rzasd/conspss.htm', note: 'H: 従来型の制御仕様ステートメント（桁レイアウト）' },
      { name: 'F-SPEC-layout', topic: 'ssw_ibm_i_74/rzasd/fdsent.htm',  note: 'F: 従来型のファイル記述仕様書ステートメント（桁レイアウト）' },
      { name: 'D-SPEC-layout', topic: 'ssw_ibm_i_74/rzasd/dsent.htm',   note: 'D: 従来型の定義仕様書ステートメント（桁レイアウト）' },
      { name: 'I-SPEC-layout', topic: 'ssw_ibm_i_74/rzasd/inpsstm.htm', note: 'I: 入力仕様ステートメント（桁レイアウト）' },
      { name: 'C-SPEC-layout', topic: 'ssw_ibm_i_74/rzasd/calss.htm',   note: 'C: 従来型の演算仕様ステートメント（桁レイアウト）' },
      { name: 'O-SPEC-layout', topic: 'ssw_ibm_i_74/rzasd/outspc.htm',  note: 'O: 出力仕様ステートメント（桁レイアウト）' },
      { name: 'P-SPEC-layout', topic: 'ssw_ibm_i_74/rzasd/psent.htm',   note: 'P: 従来型のプロシージャー仕様書ステートメント（桁レイアウト）' },

      // --- 第5弾: I/O 仕様書は「プログラム記述/外部記述」で桁の意味が変わる。
      //     1つの定義では表せないため、レイアウトを個別に取得する。 ---
      { name: 'I-SPEC-layout-program',  topic: 'ssw_ibm_i_74/rzasd/proglay.htm', note: 'I: プログラム記述ファイルのレイアウト（桁）' },
      { name: 'I-SPEC-layout-external', topic: 'ssw_ibm_i_74/rzasd/extlay.htm',  note: 'I: 外部記述ファイルのレイアウト（桁）' },
      { name: 'O-SPEC-layout-program',  topic: 'ssw_ibm_i_74/rzasd/prlay.htm',   note: 'O: プログラム記述ファイルのレイアウト（桁）' },
      { name: 'O-SPEC-layout-external', topic: 'ssw_ibm_i_74/rzasd/exlay.htm',   note: 'O: 外部記述ファイルのレイアウト（桁）' },

      // --- 第6弾: 命令コード・組み込み関数（補完用） ---
      { name: 'OPCODES',  topic: 'ssw_ibm_i_74/rzasd/operxcl.htm', note: '命令コードの索引（C仕様の補完用）' },
      { name: 'BIFS',     topic: 'ssw_ibm_i_74/rzasd/bifs.htm',    note: '組み込み関数の索引（%XXX の補完用）' },
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
