     H DFTACTGRP(*NO) ACTGRP(*NEW) OPTION(*SRCSTMT)
     FSALESIN   IF   F  100        DISK
     FSALESRPT  O    F  132        PRINTER    OFLIND(*INOF)
     D TOTAL           S             11P 2 INZ(0)
      * I 仕様書（プログラム記述）: レコード識別とフィールド記述
     ISALESIN   NS
     I                                  1    5  CUSTNO
     I                                  6   35  CUSTNM
     I                                 36   44 2AMOUNT
      * C 仕様書
     C                   EVAL      TOTAL = TOTAL + AMOUNT
     C                   EXCEPT    DETAIL
     C                   SETON                                        LR
      * O 仕様書（プログラム記述）: 例外出力
     OSALESRPT  E            DETAIL
     O                       CUSTNO              10
     O                       CUSTNM              45
     O                       AMOUNT              60
      * P 仕様書: サブプロシージャー
     PCALCTAX          B                   EXPORT
     D CALCTAX         PI            11P 2
     D   AMT                         11P 2 CONST
     C                   RETURN    AMT * 0.10
     PCALCTAX          E
