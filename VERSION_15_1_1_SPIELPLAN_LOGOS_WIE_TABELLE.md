# Version 15.1.1 – Spielplan-Logos wie Tabelle

- Der Spielplan verwendet für jeden Verein zuerst das bereits erkannte Logo aus der offiziellen Tabelle.
- Die Zuordnung erfolgt über Vereins-ID und normalisierten Vereinsnamen.
- Offizielle ÖFB-Vereinswappen aus `vereine3/images` in 100x100 bis 200x200 werden als vertrauenswürdige Logos akzeptiert.
- Die Änderung gilt zentral für Spielplan, Kalender, Dashboard, Mannschaftsseiten und Spieldetails, da alle Bereiche dieselbe `TeamLogo`-Komponente verwenden.
- Wenn ein Tabellenlogo nicht geladen werden kann, bleiben die bisherigen Club- und Match-Logo-Rückfälle aktiv.
