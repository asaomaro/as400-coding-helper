     H DFTACTGRP(*NO) DATFMT(*ISO)
     FCMPLXP    OF   E             PRINTER OFLIND(*INOF)
     DCUSTDATA         DS                  QUALIFIED DIM(30)
     DNO                              7P 0
     DNAME                           30A
     DBAL                            11P 2
     DSTS                             4A
     DI                S             10I 0
     DMAXROW           C                   CONST(30)
     C                   FOR       I = 1 TO MAXROW
     C                   EVAL      CUSTDATA(I).NO = 2000000 + I
     C                   EVAL      CUSTDATA(I).NAME = '取引先' + %CHAR(I)
     C                   EVAL      CUSTDATA(I).BAL = I * 987.65
     C                   IF        %REM(I:7) = 0
     C                   EVAL      CUSTDATA(I).STS = 'HOLD'
     C                   ELSE
     C                   EVAL      CUSTDATA(I).STS = 'OK'
     C                   ENDIF
     C                   ENDFOR
     C                   Z-ADD     0             PCNT
     C                   Z-ADD     0             PTOTAL
     C                   EVAL      PDATE = %DEC(%DATE():*YMD)
     C                   Z-ADD     1             PPAGE
     C                   WRITE     PHEAD
     C                   WRITE     PCOLH
     C     1             DO        MAXROW        I
     C   OF              ADD       1             PPAGE
     C   OF              WRITE     PHEAD
     C   OF              WRITE     PCOLH
     C   OF              SETOFF                                       OF
     C                   Z-ADD     CUSTDATA(I).NOPCUSNO
     C                   EVAL      PCUSNM = CUSTDATA(I).NAME
     C                   EVAL      PBAL = CUSTDATA(I).BAL
     C                   EVAL      PSTS = CUSTDATA(I).STS
     C                   WRITE     PDETL
     C                   ADD       1             PCNT
     C                   ADD       PBAL          PTOTAL
     C                   ENDDO
     C                   WRITE     PTOTL
     C                   SETON                                        LR