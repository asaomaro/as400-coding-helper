     D MSG             S             60
     D NO              S              5  0 INZ(12)
     C                   EVAL      MSG = '伝票番号：' +
     C                             %CHAR(NO) + ' を登録しました'
     C                   SETON                                        LR
