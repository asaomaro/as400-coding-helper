     H DFTACTGRP(*NO)
     Fmixcased  CF   E             WORKSTN
     D loadSubfile     PR
     D rowCount        S              5P 0
     C                   callp     loadSubfile
     C                   exfmt     Rec
     C                   seton                                        LR
     P loadSubfile     B
     C                   eval      rowCount = rowCount + 1
     P loadSubfile     E
