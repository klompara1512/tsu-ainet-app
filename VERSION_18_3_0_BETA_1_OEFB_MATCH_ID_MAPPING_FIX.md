# 18.3.0-beta.1 – ÖFB Match-ID Mapping Fix

- Offizielle ÖFB-Spielbericht-ID wird vorrangig anhand der Paarung Heim/Gast und des Datums zugeordnet.
- Bei manuellen Reparaturläufen darf eine eindeutige Paarung auch dann über das offizielle Override aufgelöst werden, wenn `kickoffAt` in Firestore fehlt oder falsch ist.
- Alte bekannte Overrides werden nicht mehr dauerhaft in jeden manuellen Lauf gezogen; das Override-Datum muss im aktuellen manuellen Prüfzeitraum liegen.
- Diagnoseausgabe `ÖFB-Zuordnung` zeigt Paarung, Datum, aufgelöste ÖFB-ID und Quelle.
- Referenz U17 09.08.2026: ÖFB-ID 4173991.
