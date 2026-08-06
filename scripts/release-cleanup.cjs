#!/usr/bin/env node
"use strict";
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const obsolete=[
  "scripts/instagram-news-sync.cjs",
  ".github/workflows/instagram-news-sync.yml",
  "INSTAGRAM_NEWS_SYNC_EINRICHTUNG.md",
];
let removed=0;
for(const relative of obsolete){
  const file=path.join(root,relative);
  if(fs.existsSync(file)){fs.rmSync(file,{force:true});console.log(`Entfernt: ${relative}`);removed++;}
}
console.log(removed ? `${removed} veraltete Instagram-Datei(en) entfernt.` : "Keine veralteten Instagram-Dateien vorhanden.");
