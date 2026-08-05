# Version 18.1.8 – Mobile Editor Final Fix

- ClubPeopleManager-Dialog wird über React Portal direkt in `document.body` gerendert.
- Der Dialog kann dadurch nicht mehr durch App-Container oder Navigation abgeschnitten werden.
- Die reale Höhe des mobilen Viewports wird über `visualViewport` berücksichtigt.
- Kopfzeile und Aktionsleiste bleiben sichtbar; ausschließlich der Formularinhalt scrollt.
- Untere Navigation wird während des Bearbeitens ausgeblendet.
- PWA-Cache und App-Version wurden auf 18.1.8 erhöht.
