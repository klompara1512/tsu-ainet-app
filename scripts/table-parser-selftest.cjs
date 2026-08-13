#!/usr/bin/env node
"use strict";

const rowRx = /^(\d{1,2})[.)]?\s+(?:(-?\d{1,3})\s+)?(.{2,110}?)\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,3})\s*:\s*(\d{1,3})\s+(-?\d{1,3})\s+(\d{1,3})$/;
const samples = [
  ["Challenge", "1 3 SG WSG Radenthein/FC Bad Kleinkirchheim 1 1 0 0 5:2 3 3", "SG WSG Radenthein/FC Bad Kleinkirchheim", 1, 3],
  ["Challenge Ainet", "5 0 Ainet 0 0 0 0 0:0 0 0", "Ainet", 0, 0],
  ["KM", "1 6 Lurnfeld 2 2 0 0 6:2 4 6", "Lurnfeld", 2, 6],
  ["U12 null", "1 0 Musterverein U12 0 0 0 0 0:0 0 0", "Musterverein U12", 0, 0],
];
for (const [name, text, club, played, points] of samples) {
  const m = text.match(rowRx);
  if (!m) throw new Error(`${name}: Zeile nicht erkannt`);
  if (m[3] !== club || Number(m[4]) !== played || Number(m[11]) !== points) throw new Error(`${name}: Falsche Zuordnung ${JSON.stringify(m.slice(1))}`);
  if (Number(m[4]) !== Number(m[5]) + Number(m[6]) + Number(m[7])) throw new Error(`${name}: S/U/N unplausibel`);
  if (Number(m[10]) !== Number(m[8]) - Number(m[9])) throw new Error(`${name}: Tordifferenz unplausibel`);
}
console.log(`Tabellenparser-Selbsttest erfolgreich: ${samples.length} Varianten.`);
