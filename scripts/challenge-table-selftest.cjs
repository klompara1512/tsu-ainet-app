"use strict";
const assert = require("assert");
const { parseChallengeRows, validateChallengeTable } = require("./challenge-table-parser.cjs");
const clubs = [
  [1,"SG WSG Radenthein/FC Bad Kleinkirchheim",2,2,0,0,"11:5",6,6],
  [2,"SG SV Malta/FC Rennweg",2,1,1,0,"3:0",3,4],
  [3,"Mölltal",1,1,0,0,"3:1",2,3],
  [4,"SG Berg/Dellach/Dr.",1,1,0,0,"3:2",1,3],
  [5,"Oberlienz",2,1,0,1,"6:6",0,3],
  [6,"Treffen",2,1,0,1,"3:3",0,3],
  [7,"Irschen",2,1,0,1,"3:3",0,3],
  [8,"Gitschtal",1,0,1,0,"0:0",0,1],
  [9,"Tristach",0,0,0,0,"0:0",0,0],
  [10,"Obermillstatt",1,0,0,1,"1:3",-2,0],
  [11,"Penk",1,0,0,1,"0:3",-3,0],
  [12,"SG OSK Kötschach - Mauthen/SK Grafendorf",2,0,0,2,"4:8",-4,0],
  [13,"Ainet",1,0,0,1,"0:3",-3,0],
];
const raw = clubs.map(([pos,name,sp,s,u,n,goals,diff,pkt]) => ({
  cells: [String(pos), pos > 2 ? "▼ (-2)" : "●", "", name, String(sp), String(s), String(u), String(n), goals, String(diff), String(pkt)].map((text, i) => ({ text, img: i === 2 ? `https://example.invalid/${pos}.png` : "" })),
}));
const rows = parseChallengeRows(raw);
const { ainet } = validateChallengeTable(rows);
assert.equal(rows.length, 13);
assert.equal(rows[0].clubName, "SG WSG Radenthein/FC Bad Kleinkirchheim");
assert.equal(rows[0].points, 6);
assert.equal(rows[1].points, 4);
assert.equal(ainet.position, 13);
assert.equal(ainet.played, 1);
assert.equal(ainet.goalsAgainst, 3);
assert.equal(ainet.points, 0);
console.log("Challenge Tabellenparser Selbsttest: 13/13 Zeilen korrekt, Ainet Platz 13 / 0 Punkte.");
