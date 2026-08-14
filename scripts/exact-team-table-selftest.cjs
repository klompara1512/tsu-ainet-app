"use strict";
const { parseExactTableRows, validateExactTable } = require("./exact-team-table-parser.cjs");
const teamKey = String(process.env.TABLE_TEAM || process.argv[2] || "KM").toUpperCase();
const minRows = teamKey === "KM" ? 8 : teamKey === "U17" ? 5 : 4;
const names = teamKey === "KM"
  ? ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Ainet", "India", "Juliet"]
  : ["Alpha", "Bravo", "Ainet", "Delta", "Echo", "Foxtrot"];
const raw = names.map((name, index) => ({ cells: [
  { text: String(index + 1) }, { text: name }, { text: index < 2 ? "1" : "0" }, { text: index === 0 ? "1" : "0" }, { text: "0" }, { text: index === 1 ? "1" : "0" }, { text: index === 0 ? "2:0" : index === 1 ? "0:2" : "0:0" }, { text: index === 0 ? "2" : index === 1 ? "-2" : "0" }, { text: index === 0 ? "3" : "0" },
] }));
const rows = parseExactTableRows(raw);
const result = validateExactTable(rows, { teamKey, minRows, maxRows: 24 });
if (!result.ainet) throw new Error(`${teamKey} Selbsttest: Ainet fehlt.`);
console.log(`${teamKey} Tabellenparser Selbsttest: ${rows.length}/${names.length} Zeilen korrekt, Ainet Platz ${result.ainet.position}.`);
