             PGM
/* ゴールデン採取用のドライバ。DSPF 単体では画面を出せないため必須。               */
/* フィールドに既知の値を入れて実機に描かせる——キャプチャを加工しないため。        */
/* 手順は docs/dds-golden/README.md を参照。                                       */
             DCLF       FILE(ASAOLIB/AIDVGA)
             CHGVAR     VAR(&FLD1) VALUE('XXXXX')
             CHGVAR     VAR(&FLD2) VALUE('XXXXXXXX')
             CHGVAR     VAR(&FLD3) VALUE(9999)
             SNDRCVF    RCDFMT(GA)
             ENDPGM
