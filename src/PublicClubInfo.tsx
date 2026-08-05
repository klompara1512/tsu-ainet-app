import "./PublicPages.css";
export default function PublicClubInfo({ onBack }: { onBack: () => void }) {
  return <section className="public-page"><header className="public-page-head"><button type="button" onClick={onBack}>‹</button><h2>Verein</h2><span /></header><article className="public-club-card"><img src="/tsu-ainet-logo.png" alt="TSU Ainet" /><h1>TSU Ainet</h1><p>Turn- und Sportunion Ainet</p><dl><div><dt>Heimstätte</dt><dd>Sandgrubenstadion Ainet</dd></div><div><dt>Vereinsfarben</dt><dd>Rot · Gelb · Blau</dd></div><div><dt>Ort</dt><dd>Ainet, Osttirol</dd></div></dl><a href="https://www.google.com/maps/search/?api=1&query=Sportplatz+Ainet" target="_blank" rel="noreferrer">Anfahrt öffnen</a></article></section>;
}
