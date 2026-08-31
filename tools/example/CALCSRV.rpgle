     H NOMAIN
      /COPY QUNITSRC,CALCPR
     PADDTAX           B                   EXPORT
     DADDTAX           PI            11P 2
     D AMOUNT                        11P 2   CONST
     D RATE                           5P 3   CONST
     C                   RETURN    %DEC(AMOUNT * (1 + RATE) : 11 : 2)
     PADDTAX           E
