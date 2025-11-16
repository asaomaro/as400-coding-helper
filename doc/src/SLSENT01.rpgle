H*=====================================================================
     H* プログラム名: SLSENT01
     H* 機能概要    : 売上伝票入力処理
     H* 作成日      : 2024/01/15
     H* 作成者      : システム開発部
     H* 備考        : PCパーツ販売店向け売上伝票入力システム
     H*=====================================================================
     H DATEDIT(*YMD) DATFMT(*ISO)
     H OPTION(*NODEBUGIO)
     H DFTACTGRP(*NO) ACTGRP(*NEW)
     H*
     F*=====================================================================
     F* ファイル定義
     F*=====================================================================
     F* 売上ヘッダーマスタ
     FSLSHDRP   UF A E           K DISK    USROPN
     F                                     RENAME(SLSHDR:SLSHDR)
     F* 売上明細マスタ
     FSLSDTLP   UF A E           K DISK    USROPN
     F                                     RENAME(SLSDTL:SLSDTL)
     F* 得意先マスタ
     FCUSTMSTP  IF   E           K DISK    USROPN
     F                                     RENAME(CUSTMST:CUSTREC)
     F* 商品マスタ
     FITEMMSTP  IF   E           K DISK    USROPN
     F                                     RENAME(ITEMMST:ITEMREC)
     F* 画面ファイル
     FSLSDSP    CF   E             WORKSTN SFILE(DTLSFL:RRN)
     F                                     INFDS(WSINFO)
     F*
     D*=====================================================================
     D* データ構造定義
     D*=====================================================================
     D*-- ワークステーション情報
     D WSINFO          DS
     D  WSKEY                369    369A
     D*
     D*-- 日付時刻編集用
     D DATETIME        DS
     D  WDATE                  8S 0
     D  WTIME                  6S 0
     D  WYY                    4S 0 OVERLAY(WDATE:1)
     D  WMM                    2S 0 OVERLAY(WDATE:5)
     D  WDD                    2S 0 OVERLAY(WDATE:7)
     D  WHH                    2S 0 OVERLAY(WTIME:1)
     D  WMI                    2S 0 OVERLAY(WTIME:3)
     D  WSS                    2S 0 OVERLAY(WTIME:5)
     D*
     D*-- エラーコード用API
     D ERRCODE         DS
     D  BYTPVD                     10I 0 INZ(0)
     D  BYTAVL                     10I 0
     D  MSGID                       7A
     D*
     D*=====================================================================
     D* スタンドアロン変数定義
     D*=====================================================================
     D*-- サブファイル制御
     D RRN             S              4S 0
     D SFLSIZ          S              4S 0 INZ(9999)
     D SFLPAG          S              4S 0 INZ(10)
     D TOPRRN          S              4S 0
     D BOTRRN          S              4S 0
     D CURRRN          S              4S 0
     D*
     D*-- 伝票番号関連
     D SLSNO           S              8S 0
     D MAXSLSNO        S              8S 0
     D SEQNO           S              3S 0
     D*
     D*-- 作業用変数
     D WUSER           S             10A
     D TODAY           S               D   DATFMT(*ISO)
     D ERRFLG          S              1A
     D CNT             S              4S 0
     D I               S              4S 0
     D*
     D*-- 合計金額計算用
     D TOTAMT          S             11S 0
     D TOTTAX          S             11S 0
     D TOTQTY          S              7S 0
     D TAXRATE         S              3S 2 INZ(0.10)
     D*
     D*-- ワーク項目
     D WSLSNO          S              8S 0
     D WCUSTCD         S              6S 0
     D WCUSTNM         S             40A
     D WSLSDT          S              8S 0
     D WSTFCD          S              4S 0
     D WSTFNM          S             20A
     D WRMRK           S             60A
     D*
     D*-- 明細ワーク
     D WITEMCD         S             10A
     D WITEMNM         S             50A
     D WQTY            S              5S 0
     D WUPRC           S              9S 0
     D WAMT            S             11S 0
     D WTAX            S             11S 0
     D*
     D*=====================================================================
     D* 定数定義
     D*=====================================================================
     D C_NEW           C                   CONST('1')
     D C_UPD           C                   CONST('2')
     D C_MODE          S              1A
     D*
     C*=====================================================================
     C* メイン処理
     C*=====================================================================
     C*-- 初期処理
     C                   EXSR      INIT
     C*
     C*-- メインループ
     C                   DOU       *IN03 = *ON
     C*
     C*---- ヘッダー入力
     C                   EXSR      HDRINP
     C*
     C*---- キャンセルチェック
     C                   IF        *IN12 = *ON OR *IN03 = *ON
     C                   LEAVE
     C                   ENDIF
     C*
     C*---- 明細入力
     C                   EXSR      DTLINP
     C*
     C*---- 登録確認
     C                   IF        *IN12 = *OFF AND *IN03 = *OFF
     C                   EXSR      CONFIRM
     C                   ENDIF
     C*
     C                   ENDDO
     C*
     C*-- 終了処理
     C                   EXSR      TERM
     C*
     C                   EVAL      *INLR = *ON
     C                   RETURN
     C*
     C*=====================================================================
     C* サブルーチン: 初期処理
     C*=====================================================================
     C     INIT          BEGSR
     C*
     C*-- システム日付・時刻取得
     C                   TIME                    WDATE
     C                   TIME                    WTIME
     C                   EVAL      TODAY = %DATE()
     C*
     C*-- ユーザープロファイル取得
     C                   CALL      'QWCRNETA'
     C                   PARM                    WUSER
     C                   PARM      10            CNT
     C                   PARM      'USRPRF   '   CNT
     C                   PARM                    ERRCODE
     C*
     C*-- ファイルオープン
     C                   OPEN      SLSHDR
     C                   OPEN      SLSDTL
     C                   OPEN      CUSTMST
     C                   OPEN      ITEMMST
     C*
     C*-- 処理モード設定（新規）
     C                   EVAL      C_MODE = C_NEW
     C*
     C                   ENDSR
     C*
     C*=====================================================================
     C* サブルーチン: ヘッダー入力
     C*=====================================================================
     C     HDRINP        BEGSR
     C*
     C*-- 画面初期化
     C                   IF        C_MODE = C_NEW
     C                   EXSR      GETNEWNO
     C                   EVAL      HSLSNO = WSLSNO
     C                   EVAL      HSLSDT = WDATE
     C                   EVAL      HCUSTCD = 0
     C                   EVAL      HCUSTNM = *BLANKS
     C                   EVAL      HSTFCD = 0
     C                   EVAL      HSTFNM = *BLANKS
     C                   EVAL      HRMRK = *BLANKS
     C                   ENDIF
     C*
     C*-- ヘッダー入力ループ
     C                   DOU       *IN12 = *ON OR *IN03 = *ON
     C*
     C                   EVAL      HERRMSG = *BLANKS
     C                   EXFMT     SLSHDR
     C*
     C                   IF        *IN12 = *ON OR *IN03 = *ON
     C                   LEAVE
     C                   ENDIF
     C*
     C*---- 入力チェック
     C                   EXSR      CHKHDR
     C*
     C                   IF        ERRFLG = *OFF
     C*
     C*------ ヘッダー情報保存
     C                   EVAL      WSLSNO = HSLSNO
     C                   EVAL      WCUSTCD = HCUSTCD
     C                   EVAL      WCUSTNM = HCUSTNM
     C                   EVAL      WSLSDT = HSLSDT
     C                   EVAL      WSTFCD = HSTFCD
     C                   EVAL      WSTFNM = HSTFNM
     C                   EVAL      WRMRK = HRMRK
     C*
     C                   LEAVE
     C                   ENDIF
     C*
     C                   ENDDO
     C*
     C                   ENDSR
     C*
     C*=====================================================================
     C* サブルーチン: ヘッダー入力チェック
     C*=====================================================================
     C     CHKHDR        BEGSR
     C*
     C                   EVAL      ERRFLG = *OFF
     C*
     C*-- 売上日チェック
     C                   IF        HSLSDT = 0
     C                   EVAL      HERRMSG = '売上日を入力してください'
     C                   EVAL      ERRFLG = *ON
     C                   LEAVESR
     C                   ENDIF
     C*
     C*-- 得意先コードチェック
     C                   IF        HCUSTCD = 0
     C                   EVAL      HERRMSG = '得意先コードを入力してください'
     C                   EVAL      ERRFLG = *ON
     C                   LEAVESR
     C                   ENDIF
     C*
     C*-- 得意先マスタ存在チェック
     C     HCUSTCD       CHAIN     CUSTREC
     C                   IF        NOT %FOUND(CUSTMST)
     C                   EVAL      HERRMSG = '得意先コードが登録されていません'
     C                   EVAL      ERRFLG = *ON
     C                   LEAVESR
     C                   ELSE
     C                   EVAL      HCUSTNM = CUSTNM
     C                   ENDIF
     C*
     C*-- 担当者コードチェック
     C                   IF        HSTFCD = 0
     C                   EVAL      HERRMSG = '担当者コードを入力してください'
     C                   EVAL      ERRFLG = *ON
     C                   LEAVESR
     C                   ENDIF
     C*
     C*-- 担当者名セット（簡易実装）
     C                   EVAL      HSTFNM = '営業担当'
     C*
     C                   ENDSR
     C*
     C*=====================================================================
     C* サブルーチン: 明細入力
     C*=====================================================================
     C     DTLINP        BEGSR
     C*
     C*-- サブファイル初期化
     C                   EXSR      INTSFL
     C*
     C*-- 明細入力ループ
     C                   DOU       *IN03 = *ON OR *IN12 = *ON
     C*
     C*---- 画面表示
     C                   EVAL      DSLSNO = WSLSNO
     C                   EVAL      DSLSDT = WSLSDT
     C                   EVAL      DCUSTCD = WCUSTCD
     C                   EVAL      DCUSTNM = WCUSTNM
     C                   EVAL      DERRMSG = *BLANKS
     C*
     C                   WRITE     DTLFTR
     C                   EXFMT     DTLCTL
     C*
     C                   IF        *IN03 = *ON OR *IN12 = *ON
     C                   LEAVE
     C                   ENDIF
     C*
     C*---- 明細チェックと集計
     C                   EXSR      CHKDTL
     C*
     C                   IF        ERRFLG = *OFF AND RRN > 0
     C                   LEAVE
     C                   ENDIF
     C*
     C                   ENDDO
     C*
     C                   ENDSR
     C*
     C*=====================================================================
     C* サブルーチン: サブファイル初期化
     C*=====================================================================
     C     INTSFL        BEGSR
     C*
     C*-- サブファイルクリア
     C                   EVAL      *IN40 = *OFF
     C                   WRITE     DTLCTL
     C                   EVAL      *IN40 = *ON
     C                   EVAL      RRN = 0
     C*
     C*-- 初期明細作成（10行）
     C                   FOR       I = 1 TO 10
     C                   EVAL      RRN = RRN + 1
     C                   EVAL      DSEQ = RRN
     C                   EVAL      DITEMCD = *BLANKS
     C                   EVAL      DITEMNM = *BLANKS
     C                   EVAL      DQTY = 0
     C                   EVAL      DUPRC = 0
     C                   EVAL      DAMT = 0
     C                   EVAL      DTAX = 0
     C                   WRITE     DTLSFL
     C                   ENDFOR
     C*
     C*-- サブファイル表示設定
     C                   EVAL      *IN41 = *ON
     C*
     C                   ENDSR
     C*
     C*=====================================================================
     C* サブルーチン: 明細チェック・集計
     C*=====================================================================
     C     CHKDTL        BEGSR
     C*
     C                   EVAL      ERRFLG = *OFF
     C                   EVAL      TOTAMT = 0
     C                   EVAL      TOTTAX = 0
     C                   EVAL      TOTQTY = 0
     C                   EVAL      CNT = 0
     C*
     C*-- サブファイル明細ループ
     C                   FOR       I = 1 TO RRN
     C*
     C                   CHAIN     I             DTLSFL
     C*
     C*---- 入力行チェック
     C                   IF        DITEMCD <> *BLANKS
     C*
     C*------ 商品マスタチェック
     C     DITEMCD       CHAIN     ITEMREC
     C                   IF        NOT %FOUND(ITEMMST)
     C                   EVAL      DERRMSG = '商品コードが登録されていません'
     C                   EVAL      ERRFLG = *ON
     C                   LEAVESR
     C                   ELSE
     C                   EVAL      DITEMNM = ITEMNM
     C                   EVAL      DUPRC = STDPRC
     C                   ENDIF
     C*
     C*------ 数量チェック
     C                   IF        DQTY <= 0
     C                   EVAL      DERRMSG = '数量を入力してください'
     C                   EVAL      ERRFLG = *ON
     C                   LEAVESR
     C                   ENDIF
     C*
     C*------ 単価チェック
     C                   IF        DUPRC <= 0
     C                   EVAL      DERRMSG = '単価を入力してください'
     C                   EVAL      ERRFLG = *ON
     C                   LEAVESR
     C                   ENDIF
     C*
     C*------ 金額計算
     C                   EVAL      DAMT = DQTY * DUPRC
     C                   EVAL      DTAX = %INT(DAMT * TAXRATE)
     C*
     C*------ 集計
     C                   EVAL      TOTAMT = TOTAMT + DAMT
     C                   EVAL      TOTTAX = TOTTAX + DTAX
     C                   EVAL      TOTQTY = TOTQTY + DQTY
     C                   EVAL      CNT = CNT + 1
     C*
     C*------ サブファイル更新
     C                   UPDATE    DTLSFL
     C*
     C                   ENDIF
     C*
     C                   ENDFOR
     C*
     C*-- 明細件数チェック
     C                   IF        CNT = 0
     C                   EVAL      DERRMSG = '明細を入力してください'
     C                   EVAL      ERRFLG = *ON
     C                   ENDIF
     C*
     C*-- フッター項目セット
     C                   EVAL      FTOTQTY = TOTQTY
     C                   EVAL      FTOTAMT = TOTAMT
     C                   EVAL      FTOTTAX = TOTTAX
     C                   EVAL      FGTTL = TOTAMT + TOTTAX
     C*
     C                   ENDSR
     C*
     C*=====================================================================
     C* サブルーチン: 登録確認・実行
     C*=====================================================================
     C     CONFIRM       BEGSR
     C*
     C*-- 確認画面表示
     C                   EVAL      CSLSNO = WSLSNO
     C                   EVAL      CSLSDT = WSLSDT
     C                   EVAL      CCUSTCD = WCUSTCD
     C                   EVAL      CCUSTNM = WCUSTNM
     C                   EVAL      CTOTQTY = TOTQTY
     C                   EVAL      CTOTAMT = TOTAMT
     C                   EVAL      CTOTTAX = TOTTAX
     C                   EVAL      CGTTL = TOTAMT + TOTTAX
     C*
     C                   EXFMT     SLSCFM
     C*
     C*-- キャンセルチェック
     C                   IF        *IN12 = *ON
     C                   LEAVESR
     C                   ENDIF
     C*
     C*-- ヘッダー登録
     C                   EXSR      ADDHDR
     C*
     C*-- 明細登録
     C                   EXSR      ADDDTL
     C*
     C*-- 完了メッセージ
     C                   EVAL      CMPMSG = '伝票番号:' +
     C                             %CHAR(WSLSNO) + ' を登録しました'
     C                   EXFMT     SLSCMP
     C*
     C*-- 次伝票へ
     C                   EVAL      C_MODE = C_NEW
     C*
     C                   ENDSR
     C*
     C*=====================================================================
     C* サブルーチン: ヘッダー登録
     C*=====================================================================
     C     ADDHDR        BEGSR
     C*
     C*-- ヘッダーレコードセット
     C                   EVAL      HSLSNO = WSLSNO
     C                   EVAL      HSLSDT = WSLSDT
     C                   EVAL      HCUSTCD = WCUSTCD
     C                   EVAL      HSTFCD = WSTFCD
     C                   EVAL      HRMRK = WRMRK
     C                   EVAL      HTOTAMT = TOTAMT
     C                   EVAL      HTOTTAX = TOTTAX
     C                   EVAL      HGTTL = TOTAMT + TOTTAX
     C                   EVAL      HCDATE = WDATE
     C                   EVAL      HCTIME = WTIME
     C                   EVAL      HCUSER = WUSER
     C                   EVAL      HUDATE = WDATE
     C                   EVAL      HUTIME = WTIME
     C                   EVAL      HUUSER = WUSER
     C*
     C*-- ヘッダー書込
     C                   WRITE     SLSHDR
     C*
     C                   ENDSR
     C*
     C*=====================================================================
     C* サブルーチン: 明細登録
     C*=====================================================================
     C     ADDDTL        BEGSR
     C*
     C                   EVAL      SEQNO = 0
     C*
     C*-- サブファイル明細ループ
     C                   FOR       I = 1 TO RRN
     C*
     C                   CHAIN     I             DTLSFL
     C*
     C*---- 入力行のみ登録
     C                   IF        DITEMCD <> *BLANKS
     C*
     C                   EVAL      SEQNO = SEQNO + 1
     C*
     C*------ 明細レコードセット
     C                   EVAL      DSLSNO = WSLSNO
     C                   EVAL      DSEQNO = SEQNO
     C                   EVAL      DITMCD = DITEMCD
     C                   EVAL      DQTY = DQTY
     C                   EVAL      DUPRC = DUPRC
     C                   EVAL      DAMT = DAMT
     C                   EVAL      DTAX = DTAX
     C                   EVAL      DCDATE = WDATE
     C                   EVAL      DCTIME = WTIME
     C                   EVAL      DCUSER = WUSER
     C*
     C*------ 明細書込
     C                   WRITE     SLSDTL
     C*
     C                   ENDIF
     C*
     C                   ENDFOR
     C*
     C                   ENDSR
     C*
     C*=====================================================================
     C* サブルーチン: 新規伝票番号取得
     C*=====================================================================
     C     GETNEWNO      BEGSR
     C*
     C*-- 最大伝票番号取得（簡易実装）
     C     *HIVAL        SETLL     SLSHDR
     C                   READP     SLSHDR
     C*
     C                   IF        %EOF(SLSHDR)
     C                   EVAL      MAXSLSNO = 0
     C                   ELSE
     C                   EVAL      MAXSLSNO = HSLSNO
     C                   ENDIF
     C*
     C*-- 新規番号生成
     C                   EVAL      WSLSNO = MAXSLSNO + 1
     C*
     C                   ENDSR
     C*
     C*=====================================================================
     C* サブルーチン: 終了処理
     C*=====================================================================
     C     TERM          BEGSR
     C*
     C*-- ファイルクローズ
     C                   CLOSE     SLSHDR
     C                   CLOSE     SLSDTL
     C                   CLOSE     CUSTMST
     C                   CLOSE     ITEMMST
     C*
     C                   ENDSR