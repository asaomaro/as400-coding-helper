     H DFTACTGRP(*NO)
     FQSYSPRT   O    F  132        PRINTER
     DIND01            S              1N
     DAMT              S              7P 2
     DCNT              S              5U 0
     DAddone           PR
     C                   IF        IND01
     C                   EVAL      AMT = 1.25
     C                   ELSE
     C                   CALLP     Addone()
     C                   ENDIF
     C                   SETON                                        LR
     PAddone           B
     C                   EVAL      CNT = CNT + 1
     P                 E
