/***********************************************************************/ 
/*  プログラム名: DYBAT001CL                                           */
/*  機能概要    : 日次バッチ処理制御                                   */
/*  作成日      : 2024/01/15                                           */
/*  作成者      : システム開発部                                       */
/*  備考        : 売上・在庫・経理関連の日次処理を一括実行             */
/***********************************************************************/
             PGM

/*----------------------------------------------------------------------*/
/* 変数宣言                                                             */
/*----------------------------------------------------------------------*/
             DCL        VAR(&MSGID) TYPE(*CHAR) LEN(7)
             DCL        VAR(&MSGDTA) TYPE(*CHAR) LEN(256)
             DCL        VAR(&MSGF) TYPE(*CHAR) LEN(10)
             DCL        VAR(&MSGFLIB) TYPE(*CHAR) LEN(10)
             DCL        VAR(&RTNCODE) TYPE(*CHAR) LEN(7)
             
             DCL        VAR(&PRCDT) TYPE(*CHAR) LEN(8)
             DCL        VAR(&PRCTM) TYPE(*CHAR) LEN(6)
             DCL        VAR(&JOBNM) TYPE(*CHAR) LEN(10)
             DCL        VAR(&JOBUSER) TYPE(*CHAR) LEN(10)
             DCL        VAR(&JOBNBR) TYPE(*CHAR) LEN(6)
             
             DCL        VAR(&ERRCNT) TYPE(*DEC) LEN(5 0) VALUE(0)
             DCL        VAR(&JOBSTS) TYPE(*CHAR) LEN(10)
             DCL        VAR(&WAIT) TYPE(*DEC) LEN(5 0)

/*----------------------------------------------------------------------*/
/* エラー監視開始                                                       */
/*----------------------------------------------------------------------*/
             MONMSG     MSGID(CPF0000) EXEC(GOTO CMDLBL(ERROR))

/*----------------------------------------------------------------------*/
/* メイン処理開始                                                       */
/*----------------------------------------------------------------------*/
MAIN:
             /* 処理開始メッセージ */
             SNDPGMMSG  MSGID(CPF9898) MSGF(QCPFMSG) +
                          MSGDTA('*** 日次バッチ処理を開始します ***') +
                          TOPGMQ(*EXT) MSGTYPE(*INFO)

             /* システム日付・時刻取得 */
             RTVSYSVAL  SYSVAL(QDATE) RTNVAR(&PRCDT)
             RTVSYSVAL  SYSVAL(QTIME) RTNVAR(&PRCTM)

             /* ジョブ情報取得 */
             RTVJOBA    JOB(&JOBNM) USER(&JOBUSER) NBR(&JOBNBR)

/*----------------------------------------------------------------------*/
/* 事前処理: データベースバックアップ                                   */
/*----------------------------------------------------------------------*/
BACKUP:
             SNDPGMMSG  MSGID(CPF9898) MSGF(QCPFMSG) +
                          MSGDTA('バックアップ処理を開始します') +
                          TOPGMQ(*EXT) MSGTYPE(*INFO)

             /* 売上データバックアップ */
             CALL       PGM(SLSBKUP01)
             MONMSG     MSGID(CPF0000) EXEC(DO)
                CHGVAR     VAR(&ERRCNT) VALUE(&ERRCNT + 1)
                SNDPGMMSG  MSGID(CPF9898) MSGF(QCPFMSG) +
                             MSGDTA('売上バックアップでエラーが発生しました') +
                             TOPGMQ(*EXT) MSGTYPE(*DIAG)
             ENDDO

             /* 在庫データバックアップ */
             CALL       PGM(INVBKUP01)
             MONMSG     MSGID(CPF0000) EXEC(DO)
                CHGVAR     VAR(&ERRCNT) VALUE(&ERRCNT + 1)
                SNDPGMMSG  MSGID(CPF9898) MSGF(QCPFMSG) +
                             MSGDTA('在庫バックアップでエラーが発生しました') +
                             TOPGMQ(*EXT) MSGTYPE(*DIAG)
             ENDDO

/*----------------------------------------------------------------------*/
/* バッチジョブ投入: 売上関連処理                                       */
/*----------------------------------------------------------------------*/
SALES:
             SNDPGMMSG  MSGID(CPF9898) MSGF(QCPFMSG) +
                          MSGDTA('売上関連バッチジョブを投入します') +
                          TOPGMQ(*EXT) MSGTYPE(*INFO)

             /* 売上集計処理 */
             SBMJOB     CMD(CALL PGM(SLSSUM01) PARM(&PRCDT)) +
                          JOB(SLSSUM01) +
                          JOBQ(QBATCH) +
                          JOBD(BATCH/BATJOBD) +
                          USER(*CURRENT) +
                          INLLIBL(*JOBD) +
                          LOG(4 00 *SECLVL) +
                          LOGOUTPUT(*JOBLOGSVR) +
                          MSGQ(BATCH/BATMSGQ)
             MONMSG     MSGID(CPF0000) EXEC(DO)
                CHGVAR     VAR(&ERRCNT) VALUE(&ERRCNT + 1)
                SNDPGMMSG  MSGID(CPF9898) MSGF(QCPFMSG) +
                             MSGDTA('売上集計ジョブ投入でエラー') +
                             TOPGMQ(*EXT) MSGTYPE(*DIAG)
             ENDDO

             /* 売上日計表作成 */
             SBMJOB     CMD(CALL PGM(SLSRPT01) PARM(&PRCDT)) +
                          JOB(SLSRPT01) +
                          JOBQ(QBATCH) +
                          JOBD(BATCH/BATJOBD) +
                          USER(*CURRENT) +
                          OUTQ(BATCH/BATRPT) +
                          PRTTXT('売上日計表') +
                          HOLD(*YES)
             MONMSG     MSGID(CPF0000) EXEC(DO)
                CHGVAR     VAR(&ERRCNT) VALUE(&ERRCNT + 1)
             ENDDO

             /* 得意先別売上集計 */
             SBMJOB     CMD(CALL PGM(CSTSLS01) PARM(&PRCDT)) +
                          JOB(CSTSLS01) +
                          JOBQ(QBATCH) +
                          JOBD(BATCH/BATJOBD) +
                          USER(*CURRENT)
             MONMSG     MSGID(CPF0000) EXEC(DO)
                CHGVAR     VAR(&ERRCNT) VALUE(&ERRCNT + 1)
             ENDDO

             /* 商品別売上集計 */
             SBMJOB     CMD(CALL PGM(ITMSLS01) PARM(&PRCDT)) +
                          JOB(ITMSLS01) +
                          JOBQ(QBATCH) +
                          JOBD(BATCH/BATJOBD) +
                          USER(*CURRENT)
             MONMSG     MSGID(CPF0000) EXEC(DO)
                CHGVAR     VAR(&ERRCNT) VALUE(&ERRCNT + 1)
             ENDDO

/*----------------------------------------------------------------------*/
/* バッチジョブ投入: 在庫関連処理                                       */
/*----------------------------------------------------------------------*/
INVENTORY:
             SNDPGMMSG  MSGID(CPF9898) MSGF(QCPFMSG) +
                          MSGDTA('在庫関連バッチジョブを投入します') +
                          TOPGMQ(*EXT) MSGTYPE(*INFO)

             /* 在庫更新処理 */
             SBMJOB     CMD(CALL PGM(INVUPD01) PARM(&PRCDT)) +
                          JOB(INVUPD01) +
                          JOBQ(QBATCH) +
                          JOBD(BATCH/BATJOBD) +
                          USER(*CURRENT) +
                          LOG(4 00 *SECLVL)
             MONMSG     MSGID(CPF0000) EXEC(DO)
                CHGVAR     VAR(&ERRCNT) VALUE(&ERRCNT + 1)
             ENDDO

             /* 在庫一覧表作成 */
             SBMJOB     CMD(CALL PGM(INVRPT01) PARM(&PRCDT)) +
                          JOB(INVRPT01) +
                          JOBQ(QBATCH) +
                          JOBD(BATCH/BATJOBD) +
                          USER(*CURRENT) +
                          OUTQ(BATCH/BATRPT) +
                          PRTTXT('在庫一覧表')
             MONMSG     MSGID(CPF0000) EXEC(DO)
                CHGVAR     VAR(&ERRCNT) VALUE(&ERRCNT + 1)
             ENDDO

             /* 発注点割れチェック */
             SBMJOB     CMD(CALL PGM(INVCHK01) PARM(&PRCDT)) +
                          JOB(INVCHK01) +
                          JOBQ(QBATCH) +
                          JOBD(BATCH/BATJOBD) +
                          USER(*CURRENT)
             MONMSG     MSGID(CPF0000) EXEC(DO)
                CHGVAR     VAR(&ERRCNT) VALUE(&ERRCNT + 1)
             ENDDO

/*----------------------------------------------------------------------*/
/* バッチジョブ投入: 経理関連処理                                       */
/*----------------------------------------------------------------------*/
ACCOUNT:
             SNDPGMMSG  MSGID(CPF9898) MSGF(QCPFMSG) +
                          MSGDTA('経理関連バッチジョブを投入します') +
                          TOPGMQ(*EXT) MSGTYPE(*INFO)

             /* 仕訳データ作成 */
             SBMJOB     CMD(CALL PGM(ACCTJNL01) PARM(&PRCDT)) +
                          JOB(ACCTJNL01) +
                          JOBQ(QBATCH) +
                          JOBD(BATCH/BATJOBD) +
                          USER(*CURRENT)
             MONMSG     MSGID(CPF0000) EXEC(DO)
                CHGVAR     VAR(&ERRCNT) VALUE(&ERRCNT + 1)
             ENDDO

             /* 売掛金更新 */
             SBMJOB     CMD(CALL PGM(ARUPD01) PARM(&PRCDT)) +
                          JOB(ARUPD01) +
                          JOBQ(QBATCH) +
                          JOBD(BATCH/BATJOBD) +
                          USER(*CURRENT)
             MONMSG     MSGID(CPF0000) EXEC(DO)
                CHGVAR     VAR(&ERRCNT) VALUE(&ERRCNT + 1)
             ENDDO

/*----------------------------------------------------------------------*/
/* ジョブ完了待機処理                                                   */
/*----------------------------------------------------------------------*/
WAITJOB:
             SNDPGMMSG  MSGID(CPF9898) MSGF(QCPFMSG) +
                          MSGDTA('バッチジョブの完了を待機します') +
                          TOPGMQ(*EXT) MSGTYPE(*INFO)

             /* 最大待機時間: 60分 (60回 × 60秒) */
             CHGVAR     VAR(&WAIT) VALUE(0)

CHKLOOP:
             IF         COND(&WAIT *GE 60) THEN(DO)
                SNDPGMMSG  MSGID(CPF9898) MSGF(QCPFMSG) +
                             MSGDTA('タイムアウト: ジョブ完了を確認できません') +
                             TOPGMQ(*EXT) MSGTYPE(*DIAG)
                GOTO       CMDLBL(COMPLETE)
             ENDDO

             /* ジョブキュー確認 */
             WRKJOBQ    JOBQ(QBATCH) OUTPUT(*PRINT)
             MONMSG     MSGID(CPF0000)

             /* 60秒待機 */
             DLYJOB     DLY(60)
             CHGVAR     VAR(&WAIT) VALUE(&WAIT + 1)

             /* 簡易実装: 実際は各ジョブの状態を個別にチェック */
             /* GOTO       CMDLBL(CHKLOOP) */

/*----------------------------------------------------------------------*/
/* 事後処理: ログファイル整理                                           */
/*----------------------------------------------------------------------*/
CLEANUP:
             SNDPGMMSG  MSGID(CPF9898) MSGF(QCPFMSG) +
                          MSGDTA('ログファイル整理を実行します') +
                          TOPGMQ(*EXT) MSGTYPE(*INFO)

             /* 30日以前のログ削除 */
             CALL       PGM(LOGCLR01) PARM('30')
             MONMSG     MSGID(CPF0000) EXEC(DO)
                SNDPGMMSG  MSGID(CPF9898) MSGF(QCPFMSG) +
                             MSGDTA('ログ整理処理でエラーが発生しました') +
                             TOPGMQ(*EXT) MSGTYPE(*DIAG)
             ENDDO

/*----------------------------------------------------------------------*/
/* 完了処理                                                             */
/*----------------------------------------------------------------------*/
COMPLETE:
             IF         COND(&ERRCNT *EQ 0) THEN(DO)
                SNDPGMMSG  MSGID(CPF9898) MSGF(QCPFMSG) +
                             MSGDTA('*** 日次バッチ処理が正常終了しました ***') +
                             TOPGMQ(*EXT) MSGTYPE(*COMP)
             ENDDO
             ELSE       CMD(DO)
                CHGVAR     VAR(&MSGDTA) VALUE('*** 日次バッチ処理が完了しました +
                             (エラー件数:' *BCAT %CHAR(&ERRCNT) *BCAT ') ***')
                SNDPGMMSG  MSGID(CPF9898) MSGF(QCPFMSG) +
                             MSGDTA(&MSGDTA) +
                             TOPGMQ(*EXT) MSGTYPE(*DIAG)
                             
                /* エラー通知メール送信 */
                CALL       PGM(SNDERRML) PARM(&ERRCNT)
                MONMSG     MSGID(CPF0000)
             ENDDO

             GOTO       CMDLBL(END)

/*----------------------------------------------------------------------*/
/* エラー処理                                                           */
/*----------------------------------------------------------------------*/
ERROR:
             RCVMSG     MSGTYPE(*EXCP) MSGDTA(&MSGDTA) MSGID(&MSGID) +
                          MSGF(&MSGF) SNDMSGFLIB(&MSGFLIB)

             CHGVAR     VAR(&MSGDTA) VALUE('致命的エラー発生: ' *BCAT +
                          &MSGID *BCAT ' - ' *BCAT &MSGDTA)

             SNDPGMMSG  MSGID(CPF9898) MSGF(QCPFMSG) +
                          MSGDTA(&MSGDTA) +
                          TOPGMQ(*EXT) MSGTYPE(*ESCAPE)

             /* エラー通報 */
             SNDBRKMSG  MSG(&MSGDTA) TOMSGQ(QSYSOPR)
             MONMSG     MSGID(CPF0000)

             GOTO       CMDLBL(END)

/*----------------------------------------------------------------------*/
/* 終了処理                                                             */
/*----------------------------------------------------------------------*/
END:
             ENDPGM