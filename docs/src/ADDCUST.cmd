             /* 顧客追加コマンド  F4（CMD/PARM/ELEM/QUAL/DEP）の確認用 */
             CMD        PROMPT('顧客の追加')
             PARM       KWD(CUST) TYPE(Q1) MIN(1) PROMPT('顧客ファイル')
Q1:          QUAL       TYPE(*NAME) LEN(10) MIN(1)
             QUAL       TYPE(*NAME) LEN(10) DFT(*LIBL) SPCVAL((*LIBL) (*CURLIB)) +
                        PROMPT('ライブラリー')
             PARM       KWD(NAME) TYPE(*CHAR) LEN(30) MIN(1) PROMPT('顧客名')
             PARM       KWD(RANGE) TYPE(E1) PROMPT('番号の範囲')
E1:          ELEM       TYPE(*DEC) LEN(5 0) MIN(1) PROMPT('開始')
             ELEM       TYPE(*DEC) LEN(5 0) DFT(0) PROMPT('終了')
             PARM       KWD(REPLACE) TYPE(*CHAR) LEN(4) RSTD(*YES) +
                        VALUES(*NO *YES) DFT(*NO) PROMPT('置換')
             DEP        CTL(REPLACE) PARM(NAME) NBRTRUE(*EQ 1)
