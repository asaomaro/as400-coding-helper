      * ==================================================================
      *  検証テスト（VERIFICATION）
      *  オラクル: この実例の仕様「addTax は amount * (1 + rate) を
      *            小数第 2 位まで保持して返す」
      * ==================================================================
     H NOMAIN OPTION(*SRCSTMT:*NODEBUGIO)
      /COPY RPGUNIT/QINCLUDE,TESTCASE
      /COPY QUNITSRC,CALCPR
     PTESTTAX          B                   EXPORT
     DTESTTAX          PI
     C                   CALLP     assertEqual(110: addTax(100: 0.100))
     PTESTTAX          E
     PTESTROUND        B                   EXPORT
     DTESTROUND        PI
     C                   CALLP     assertEqual(105.50: addTax(100: 0.055))
     PTESTROUND        E
