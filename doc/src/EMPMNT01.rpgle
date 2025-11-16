H*=====================================================================
     H* プログラム名: EMPMNT01
     H* 機能概要    : 社員マスタメンテナンス
     H* 作成日      : 2024/01/15
     H* 作成者      : システム開発部
     H*=====================================================================
     H DATEDIT(*YMD) DATFMT(*ISO)
     H OPTION(*NODEBUGIO)
     H*
     F*=====================================================================
     F* ファイル定義
     F*=====================================================================
     FEMPMSTP   UF A E           K DISK    USROPN
     F                                     RENAME(EMPMSTR:EMPREC)
     FEMPDSP    CF   E             WORKSTN SFILE(EMPSFL:RRN)
     F                                     INFDS(WSINFO)
     F*
     D*=====================================================================
     D* データ構造定義
     D*=====================================================================
     D*-- ワークステーション情報
     D WSINFO          DS
     D  WSKEY                369    369A
     D*
     D*-- 日付編集用
     D DATES           DS
     D  SDATE                  8S 0
     D  SYY                    4S 0 OVERLAY(SDATE:1)
     D  SMM                    2S 0 OVERLAY(SDATE:5)
     D  SDD                    2S 0 OVERLAY(SDATE:7)
     D*
     D*-- エラーメッセージ用API
     D ERRCODE         DS
     D  BYTPVD                     10I 0 INZ(0)
     D  BYTAVL                     10I 0
     D  MSGID                       7A
     D*
     D*=====================================================================
     D* スタンドアロン変数定義
     D*=====================================================================
     D RRN             S              4S 0
     D SFLSIZ          S              4S 0 INZ(9999)
     D SFLPAG          S              4S 0 INZ(15)
     D MSGLIN          S              4S 0 INZ(24)
     D ERRFLG          S              1A
     D FUNC            S              1A
     D OLDKEY          S              6S 0
     D TODAY           S               D   DATFMT(*ISO)
     D WDATE           S              8S 0
     D WTIME           S              6S 0
     D WUSER           S             10A
     D CNT             S              4S 0
     D*
     D*=====================================================================
     D* 定数定義
     D*=====================================================================
     D C_ADD           C                   CONST('1')
     D C_UPD           C                   CONST('2')
     D C_DEL           C                   CONST('4')
     D C_INQ           C                   CONST('5')
     D*
     C*=====================================================================
     C* メイン処理
     C*=====================================================================
     C*-- 初期処理
     C                   EXSR      INIT
     C*
     C*-- メインループ
     C                   DOW       *IN03 = *OFF
     C*
     C*---- 画面表示
     C                   EXSR      DSPSFL
     C*
     C*---- 終了キー判定
     C                   IF        *IN03 = *ON
     C                   LEAVE
     C                   ENDIF
     C*
     C*---- 機能キー処理
     C                   SELECT
     C*------ F6=追加
     C                   WHEN      *IN06 = *ON
     C                   EXSR      ADDEMP
     C*------ サブファイル明細処理
     C                   OTHER
     C                   EXSR      SFLDTL
     C                   ENDSL
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
     C     *DATE         MULT      10000         SDATE
     C     *DATE         SUB       SDATE         SDATE
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
     C                   OPEN      EMPMSTR
     C*
     C*-- 画面クリア
     C                   EXSR      CLRSFL
     C*
     C                   ENDSR
     C*
     C*=====================================================================
     C* サブルーチン: サブファイルクリア
     C*=====================================================================
     C     CLRSFL        BEGSR
     C*
     C                   EVAL      *IN31 = *OFF
     C                   WRITE     EMPCTL
     C                   EVAL      *IN31 = *ON
     C                   EVAL      RRN = 0
     C*
     C                   ENDSR
     C*
     C*=====================================================================
     C* サブルーチン: サブファイル表示
     C*=====================================================================
     C     DSPSFL        BEGSR
     C*
     C*-- サブファイルクリア
     C                   EXSR      CLRSFL
     C*
     C*-- 社員マスタ読込
     C     *LOVAL        SETLL     EMPREC
     C*
     C                   DOU       %EOF(EMPMSTR) OR RRN >= SFLSIZ
     C                   READ      EMPREC
     C                   IF        %EOF(EMPMSTR)
     C                   LEAVE
     C                   ENDIF
     C*
     C*---- サブファイルレコード編集
     C                   EVAL      RRN = RRN + 1
     C                   EVAL      SEMPNO = EMPNO
     C                   EVAL      SEMPNM = EMPNM
     C                   EVAL      SDEPT  = DEPT
     C                   EVAL      SPOST  = POST
     C                   EVAL      SSAL   = SAL
     C                   EVAL      SOPT   = *BLANKS
     C*
     C*---- サブファイル書込
     C                   WRITE     EMPSFL
     C*
     C                   ENDDO
     C*
     C*-- サブファイル制御
     C                   IF        RRN > 0
     C                   EVAL      *IN32 = *ON
     C                   ELSE
     C                   EVAL      *IN32 = *OFF
     C                   ENDIF
     C*
     C*-- 画面表示
     C                   EVAL      DDATE = WDATE
     C                   EVAL      DTIME = WTIME
     C                   EVAL      DUSER = WUSER
     C                   EXFMT     EMPCTL
     C*
     C                   ENDSR
     C*
     C*=====================================================================
     C* サブルーチン: サブファイル明細処理
     C*=====================================================================
     C     SFLDTL        BEGSR
     C*
     C                   EVAL      ERRFLG = *OFF
     C*
     C*-- サブファイル明細ループ
     C                   DO        RRN
     C                   EVAL      CNT = CNT + 1
     C                   CHAIN     CNT           EMPSFL
     C*
     C*---- オプション処理
     C                   IF        SOPT <> *BLANKS
     C*
     C                   SELECT
     C*------ 2=変更
     C                   WHEN      SOPT = C_UPD
     C                   EXSR      CHGEMP
     C*------ 4=削除
     C                   WHEN      SOPT = C_DEL
     C                   EXSR      DLTEMP
     C*------ 5=照会
     C                   WHEN      SOPT = C_INQ
     C                   EXSR      INQEMP
     C*------ その他
     C                   OTHER
     C                   EVAL      ERRFLG = *ON
     C                   ENDSL
     C*
     C*---- オプションクリア
     C                   EVAL      SOPT = *BLANKS
     C                   UPDATE    EMPSFL
     C*
     C                   ENDIF
     C*
     C                   ENDDO
     C*
     C*-- エラーメッセージ表示
     C                   IF        ERRFLG = *ON
     C                   EVAL      ERRMSG = '無効なオプションです'
     C                   ENDIF
     C*
     C                   ENDSR
     C*
     C*=====================================================================
     C* サブルーチン: 社員追加
     C*=====================================================================
     C     ADDEMP        BEGSR
     C*
     C*-- 入力画面初期化
     C                   EVAL      WEMPNO = 0
     C                   EVAL      WEMPNM = *BLANKS
     C                   EVAL      WDEPT  = *BLANKS
     C                   EVAL      WPOST  = *BLANKS
     C                   EVAL      WSAL   = 0
     C                   EVAL      WHDATE = 0
     C                   EVAL      ERRMSG = *BLANKS
     C*
     C*-- 入力ループ
     C                   DOU       *IN03 = *ON OR *IN12 = *ON
     C*
     C                   EXFMT     EMPADD
     C*
     C                   IF        *IN03 = *ON OR *IN12 = *ON
     C                   LEAVE
     C                   ENDIF
     C*
     C*---- 入力チェック
     C                   EXSR      CHKADD
     C*
     C                   IF        ERRFLG = *OFF
     C*
     C*------ レコード書込
     C                   EVAL      EMPNO  = WEMPNO
     C                   EVAL      EMPNM  = WEMPNM
     C                   EVAL      DEPT   = WDEPT
     C                   EVAL      POST   = WPOST
     C                   EVAL      SAL    = WSAL
     C                   EVAL      HDATE  = WHDATE
     C                   EVAL      CDATE  = WDATE
     C                   EVAL      CTIME  = WTIME
     C                   EVAL      CUSER  = WUSER
     C                   EVAL      UDATE  = WDATE
     C                   EVAL      UTIME  = WTIME
     C                   EVAL      UUSER  = WUSER
     C*
     C                   WRITE     EMPREC
     C*
     C                   EVAL      ERRMSG = '追加しました'
     C                   LEAVE
     C*
     C                   ENDIF
     C*
     C                   ENDDO
     C*
     C                   ENDSR
     C*
     C*=====================================================================
     C* サブルーチン: 社員変更
     C*=====================================================================
     C     CHGEMP        BEGSR
     C*
     C*-- レコード読込
     C     SEMPNO        CHAIN     EMPREC
     C*
     C                   IF        NOT %FOUND(EMPMSTR)
     C                   EVAL      ERRMSG = 'データが見つかりません'
     C                   EVAL      ERRFLG = *ON
     C                   LEAVESR
     C                   ENDIF
     C*
     C*-- 画面セット
     C                   EVAL      WEMPNO = EMPNO
     C                   EVAL      WEMPNM = EMPNM
     C                   EVAL      WDEPT  = DEPT
     C                   EVAL      WPOST  = POST
     C                   EVAL      WSAL   = SAL
     C                   EVAL      WHDATE = HDATE
     C                   EVAL      OLDKEY = EMPNO
     C*
     C*-- 入力ループ
     C                   DOU       *IN03 = *ON OR *IN12 = *ON
     C*
     C                   EXFMT     EMPCHG
     C*
     C                   IF        *IN03 = *ON OR *IN12 = *ON
     C                   LEAVE
     C                   ENDIF
     C*
     C*---- レコード更新
     C     OLDKEY        CHAIN     EMPREC
     C*
     C                   IF        %FOUND(EMPMSTR)
     C                   EVAL      EMPNM  = WEMPNM
     C                   EVAL      DEPT   = WDEPT
     C                   EVAL      POST   = WPOST
     C                   EVAL      SAL    = WSAL
     C                   EVAL      HDATE  = WHDATE
     C                   EVAL      UDATE  = WDATE
     C                   EVAL      UTIME  = WTIME
     C                   EVAL      UUSER  = WUSER
     C*
     C                   UPDATE    EMPREC
     C*
     C                   EVAL      ERRMSG = '変更しました'
     C                   LEAVE
     C                   ELSE
     C                   EVAL      ERRMSG = 'データが見つかりません'
     C                   ENDIF
     C*
     C                   ENDDO
     C*
     C                   ENDSR
     C*
     C*=====================================================================
     C* サブルーチン: 社員削除
     C*=====================================================================
     C     DLTEMP        BEGSR
     C*
     C*-- レコード読込
     C     SEMPNO        CHAIN     EMPREC
     C*
     C                   IF        NOT %FOUND(EMPMSTR)
     C                   EVAL      ERRMSG = 'データが見つかりません'
     C                   EVAL      ERRFLG = *ON
     C                   LEAVESR
     C                   ENDIF
     C*
     C*-- 画面セット
     C                   EVAL      WEMPNO = EMPNO
     C                   EVAL      WEMPNM = EMPNM
     C                   EVAL      WDEPT  = DEPT
     C                   EVAL      WPOST  = POST
     C                   EVAL      WSAL   = SAL
     C                   EVAL      WHDATE = HDATE
     C*
     C*-- 確認画面
     C                   EXFMT     EMPDLT
     C*
     C                   IF        *IN03 = *ON OR *IN12 = *ON
     C                   LEAVESR
     C                   ENDIF
     C*
     C*-- レコード削除
     C     SEMPNO        CHAIN     EMPREC
     C*
     C                   IF        %FOUND(EMPMSTR)
     C                   DELETE    EMPREC
     C                   EVAL      ERRMSG = '削除しました'
     C                   ELSE
     C                   EVAL      ERRMSG = 'データが見つかりません'
     C                   EVAL      ERRFLG = *ON
     C                   ENDIF
     C*
     C                   ENDSR
     C*
     C*=====================================================================
     C* サブルーチン: 社員照会
     C*=====================================================================
     C     INQEMP        BEGSR
     C*
     C*-- レコード読込
     C     SEMPNO        CHAIN     EMPREC
     C*
     C                   IF        NOT %FOUND(EMPMSTR)
     C                   EVAL      ERRMSG = 'データが見つかりません'
     C                   EVAL      ERRFLG = *ON
     C                   LEAVESR
     C                   ENDIF
     C*
     C*-- 画面セット
     C                   EVAL      WEMPNO = EMPNO
     C                   EVAL      WEMPNM = EMPNM
     C                   EVAL      WDEPT  = DEPT
     C                   EVAL      WPOST  = POST
     C                   EVAL      WSAL   = SAL
     C                   EVAL      WHDATE = HDATE
     C*
     C*-- 照会画面表示
     C                   EXFMT     EMPINQ
     C*
     C                   ENDSR
     C*
     C*=====================================================================
     C* サブルーチン: 追加時入力チェック
     C*=====================================================================
     C     CHKADD        BEGSR
     C*
     C                   EVAL      ERRFLG = *OFF
     C                   EVAL      ERRMSG = *BLANKS
     C*
     C*-- 社員番号チェック
     C                   IF        WEMPNO <= 0
     C                   EVAL      ERRMSG = '社員番号を入力してください'
     C                   EVAL      ERRFLG = *ON
     C                   LEAVESR
     C                   ENDIF
     C*
     C*-- 重複チェック
     C     WEMPNO        CHAIN     EMPREC
     C                   IF        %FOUND(EMPMSTR)
     C                   EVAL      ERRMSG = '既に登録されています'
     C                   EVAL      ERRFLG = *ON
     C                   LEAVESR
     C                   ENDIF
     C*
     C*-- 氏名チェック
     C                   IF        WEMPNM = *BLANKS
     C                   EVAL      ERRMSG = '氏名を入力してください'
     C                   EVAL      ERRFLG = *ON
     C                   LEAVESR
     C                   ENDIF
     C*
     C                   ENDSR
     C*
     C*=====================================================================
     C* サブルーチン: 終了処理
     C*=====================================================================
     C     TERM          BEGSR
     C*
     C*-- ファイルクローズ
     C                   CLOSE     EMPMSTR
     C*
     C                   ENDSR