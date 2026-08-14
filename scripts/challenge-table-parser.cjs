"use strict";

const compact = (value) => String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
const toInt = (value) => {
  const text = compact(value).replace(/[−–—]/g, "-");
  if (!/^-?\d+$/.test(text)) return null;
  const number = Number(text);
  return Number.isInteger(number) ? number : null;
};

function parseScore(value) {
  const match = compact(value).match(/^(\d{1,3})\s*:\s*(\d{1,3})$/);
  return match ? [Number(match[1]), Number(match[2])] : [null, null];
}

function looksLikeClubName(value) {
  const text = compact(value);
  if (!text || text.length < 2 || text.length > 100) return false;
  if (!/[A-Za-zÄÖÜäöüß]/.test(text)) return false;
  if (/^(?:#|mannschaft|sp\.?|s|u|n|torverh\.?|tore|diff\.?|\+\/-|pkt\.?)$/i.test(text)) return false;
  if (/^(?:▲|▼|●|•|-|\([+-]?\d+\))+$/.test(text)) return false;
  return true;
}

function parseChallengeRow(rawRow) {
  const cells = Array.isArray(rawRow?.cells)
    ? rawRow.cells.map((cell) => typeof cell === "string" ? { text: compact(cell) } : {
      text: compact(cell?.text),
      href: compact(cell?.href),
      img: compact(cell?.img),
    })
    : [];
  const texts = cells.map((cell) => cell.text);
  if (texts.length < 6) return null;

  const position = toInt(texts[0]);
  if (!position || position < 1 || position > 30) return null;

  const scoreIndex = texts.findIndex((text) => /^\d{1,3}\s*:\s*\d{1,3}$/.test(text));
  if (scoreIndex < 0) return null;

  // Der Vereinsname muss vor den Statistikspalten liegen. Bewegungsanzeige und
  // Logo-Zellen stehen auf ÖFB teilweise zwischen Rang und Vereinsname.
  let clubIndex = -1;
  for (let index = 1; index < scoreIndex; index += 1) {
    if (looksLikeClubName(texts[index])) clubIndex = index;
  }
  if (clubIndex < 1) return null;

  const numericBeforeScore = texts
    .slice(clubIndex + 1, scoreIndex)
    .map(toInt)
    .filter((value) => value !== null);
  if (numericBeforeScore.length < 4) return null;

  // Die vier letzten Zahlen unmittelbar vor dem Torverhältnis sind Sp/S/U/N.
  const [played, won, drawn, lost] = numericBeforeScore.slice(-4);
  const [goalsFor, goalsAgainst] = parseScore(texts[scoreIndex]);
  const numericAfterScore = texts.slice(scoreIndex + 1).map(toInt).filter((value) => value !== null);
  if (numericAfterScore.length < 1) return null;
  const points = numericAfterScore.at(-1);
  const goalDifference = numericAfterScore.length >= 2
    ? numericAfterScore.at(-2)
    : goalsFor - goalsAgainst;

  if (![played, won, drawn, lost, goalsFor, goalsAgainst, goalDifference, points].every(Number.isInteger)) return null;
  if ([played, won, drawn, lost, goalsFor, goalsAgainst, points].some((value) => value < 0)) return null;
  if (played !== won + drawn + lost) return null;
  if (points > played * 3 + 3) return null;

  const clubCell = cells[clubIndex] || {};
  const logoCell = cells.find((cell) => cell.img) || {};
  const linkCell = clubCell.href ? clubCell : (cells.find((cell) => cell.href) || {});

  return {
    position,
    clubName: texts[clubIndex],
    played,
    won,
    drawn,
    lost,
    goalsFor,
    goalsAgainst,
    goalDifference,
    points,
    clubUrl: linkCell.href || "",
    teamLogoUrl: logoCell.img || "",
  };
}

function parseChallengeRows(rawRows) {
  const parsed = (Array.isArray(rawRows) ? rawRows : []).map(parseChallengeRow).filter(Boolean);
  const byPosition = new Map();
  for (const row of parsed) {
    const previous = byPosition.get(row.position);
    if (!previous || row.clubName.length > previous.clubName.length) byPosition.set(row.position, row);
  }
  return [...byPosition.values()].sort((a, b) => a.position - b.position);
}

function validateChallengeTable(rows) {
  if (!Array.isArray(rows) || rows.length < 10 || rows.length > 18) {
    throw new Error(`Challenge-Tabelle unplausibel: ${rows?.length || 0} Tabellenzeilen erkannt.`);
  }
  const positions = rows.map((row) => row.position);
  if (positions[0] !== 1 || positions.some((position, index) => position !== index + 1)) {
    throw new Error(`Challenge-Tabelle unvollständig: Plätze ${positions.join(", ")}.`);
  }
  const ainet = rows.find((row) => /(?:^|\s)(?:tsu\s+)?ainet(?:\s|$)/i.test(row.clubName));
  if (!ainet) throw new Error("Challenge-Tabelle unplausibel: Ainet wurde nicht gefunden.");
  const uniqueNames = new Set(rows.map((row) => row.clubName.toLocaleLowerCase("de-AT")));
  if (uniqueNames.size !== rows.length) throw new Error("Challenge-Tabelle enthält doppelte Vereinsnamen.");
  return { ainet };
}

module.exports = { compact, parseChallengeRow, parseChallengeRows, validateChallengeTable };
