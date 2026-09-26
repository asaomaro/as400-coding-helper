     H DFTACTGRP(*NO) ACTGRP(*NEW)
     FCMPLXD    CF   E             WORKSTN SFILE(SFL01:RRN1) INDDS(IND)
     DIND              DS            99
     DF3                       3      3N
     DF12                12          12N
     DSFLDSP             31          31N
     DSFLDSPCTL          32          32N
     DSFLCLR             33          33N
     DSFLEND             34          34N
     DSTSRED             40          40N
     DERRIND             90          90N
     DCUSTDATA         DS                  QUALIFIED DIM(30)
     DNO                              7P 0
     DNAME                           30A
     DBAL                            11P 2
     DSTS                             4A
     DMAXROW           C                   CONST(30)
     DI                S             10I 0
     DOPTSEL           S              1A
     DLOADSUBFILE      PR
     C                   EVAL      DSPDATE = %DEC(%DATE():*YMD)
     C                   TIME                    DSPTIME
     C                   FOR       I = 1 TO MAXROW
     C                   EVAL      CUSTDATA(I).NO = 1000000 + I
     C                   EVAL      CUSTDATA(I).NAME = '顧客' + %CHAR(I)
     C                   EVAL(H)   CUSTDATA(I).BAL = I * 1234.567
     C                   IF        %REM(I:5) = 0
     C                   EVAL      CUSTDATA(I).STS = 'HOLD'
     C                   ELSE
     C                   EVAL      CUSTDATA(I).STS = 'OK'
     C                   ENDIF
     C                   ENDFOR
     C                   CALLP     LOADSUBFILE
     C                   WRITE     HEADER
     C                   WRITE     FOOTER
     C                   DOW       NOT F3
     C                   EXFMT     SFCTL01
     C                   EVAL      ERRIND = *OFF
     C                   IF        F3
     C                   LEAVE
     C                   ENDIF
     C                   READC     SFL01
     C                   DOW       NOT %EOF(CMPLXD)
     C                   IF        OPT <> ' ' AND OPT <> '5'
     C                   EVAL      ERRIND = *ON
     C                   EVAL      MSG = '無効なオプション'
     C                   ENDIF
     C     OPT           IFEQ      '5'
     C                   Z-ADD     CUSNO         WCUSNO
     C                   MOVEL     CUSNM         WCUSNM
     C                   EVAL      WBAL = BAL
     C                   EXFMT     WIN01
     C     RRN1          CHAIN     SFL01
     C                   ENDIF
     C                   MOVE      *BLANK        OPT
     C                   UPDATE    SFL01
     C                   READC     SFL01
     C                   ENDDO
     C                   ENDDO
     C                   SETON                                        LR
     C                   RETURN
     PLOADSUBFILE      B
     DLOADSUBFILE      PI
     C                   EVAL      SFLCLR = *ON
     C                   WRITE     SFCTL01
     C                   EVAL      SFLCLR = *OFF
     C                   Z-ADD     0             RRN1
     C     1             DO        MAXROW        I
     C                   ADD       1             RRN1
     C                   Z-ADD     CUSTDATA(I).NOCUSNO
     C                   EVAL      CUSNM = CUSTDATA(I).NAME
     C                   EVAL      BAL = CUSTDATA(I).BAL
     C                   EVAL      STS = CUSTDATA(I).STS
     C                   Z-ADD     CUSNO         CUSKEY
     C                   EVAL      STSRED = (STS = 'HOLD')
     C                   MOVEL     *BLANK        OPT
     C                   WRITE     SFL01
     C                   ENDDO
     C     RRN1          IFGT      0
     C                   EVAL      SFLDSP = *ON
     C                   ENDIF
     C                   EVAL      SFLDSPCTL = *ON
     C                   EVAL      SFLEND = *ON
     C                   Z-ADD     1             RRN1
     PLOADSUBFILE      E