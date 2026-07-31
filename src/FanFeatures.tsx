import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "./firebase";
import { enablePush, disablePush, type PushTopic } from "./push";
import { Icon } from "./Icons";
import "./FanFeatures.css";

type SquadPlayer = {
  id: string;
  name: string;
  position: string;
  imageUrl?: string;
  appearances: number;
  goals: number;
  yellowCards: number;
};

type Match = {
  id: string;
  homeTeam: string;
  awayTeam: string;
  date: string;
  time: string;
  venue: string;
  status: string;
  homeScore?: number;
  awayScore?: number;
};

type MediaItem = { id: string; title: string; url: string; imageUrl?: string; active: boolean };
type Sponsor = { id: string; name: string; url?: string; logoUrl?: string; active: boolean };

const FAVORITES_KEY = "tsu-ainet-favorite-players";

function safeText(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function safeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function escapeIcs(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function toIcsDate(date: string, time: string) {
  const normalizedDate = date.match(/^\d{4}-\d{2}-\d{2}$/) ? date.replaceAll("-", "") : "";
  const normalizedTime = time.match(/^\d{2}:\d{2}/) ? time.slice(0, 5).replace(":", "") + "00" : "120000";
  return normalizedDate ? `${normalizedDate}T${normalizedTime}` : "";
}

export default function FanFeatures() {
  const [players, setPlayers] = useState<SquadPlayer[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [gallery, setGallery] = useState<MediaItem[]>([]);
  const [videos, setVideos] = useState<MediaItem[]>([]);
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
    } catch {
      return [];
    }
  });
  const [message, setMessage] = useState("");

  useEffect(() => {
    const unsubscribers = [
      onSnapshot(collection(db, "kfvSquad"), (snapshot) => {
        setPlayers(snapshot.docs.map((entry) => {
          const data = entry.data();
          return {
            id: entry.id,
            name: safeText(data.name, "Spieler"),
            position: safeText(data.position, "Spieler"),
            imageUrl: safeText(data.imageUrl),
            appearances: safeNumber(data.appearances ?? data.einsatze),
            goals: safeNumber(data.goals ?? data.tore),
            yellowCards: safeNumber(data.yellowCards ?? data.gelbeKarten),
          };
        }).filter((player) => player.name !== "Spieler"));
      }),
      onSnapshot(collection(db, "kfvMatches"), (snapshot) => {
        setMatches(snapshot.docs.map((entry) => {
          const data = entry.data();
          return {
            id: entry.id,
            homeTeam: safeText(data.homeTeam ?? data.home, "Heim"),
            awayTeam: safeText(data.awayTeam ?? data.away, "Gast"),
            date: safeText(data.date),
            time: safeText(data.time),
            venue: safeText(data.venue ?? data.location),
            status: safeText(data.status),
            homeScore: typeof data.homeScore === "number" ? data.homeScore : undefined,
            awayScore: typeof data.awayScore === "number" ? data.awayScore : undefined,
          };
        }));
      }),
      onSnapshot(collection(db, "gallery"), (snapshot) => {
        setGallery(snapshot.docs.map((entry) => ({
          id: entry.id,
          title: safeText(entry.data().title, "Vereinsfoto"),
          url: safeText(entry.data().url ?? entry.data().imageUrl),
          imageUrl: safeText(entry.data().imageUrl ?? entry.data().url),
          active: entry.data().active !== false,
        })).filter((item) => item.active && item.url));
      }),
      onSnapshot(collection(db, "videos"), (snapshot) => {
        setVideos(snapshot.docs.map((entry) => ({
          id: entry.id,
          title: safeText(entry.data().title, "Vereinsvideo"),
          url: safeText(entry.data().url),
          imageUrl: safeText(entry.data().imageUrl),
          active: entry.data().active !== false,
        })).filter((item) => item.active && item.url));
      }),
      onSnapshot(collection(db, "sponsors"), (snapshot) => {
        setSponsors(snapshot.docs.map((entry) => ({
          id: entry.id,
          name: safeText(entry.data().name, "Sponsor"),
          url: safeText(entry.data().url),
          logoUrl: safeText(entry.data().logoUrl ?? entry.data().imageUrl),
          active: entry.data().active !== false,
        })).filter((item) => item.active));
      }),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, []);

  const sortedPlayers = useMemo(() => [...players].sort((a, b) => b.goals - a.goals || b.appearances - a.appearances || a.name.localeCompare(b.name, "de-AT")), [players]);
  const favoritePlayers = sortedPlayers.filter((player) => favorites.includes(player.id));
  const liveMatches = matches.filter((match) => /live|läuft|halbzeit/i.test(match.status));
  const nextMatches = [...matches].filter((match) => match.date).sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)).slice(0, 6);

  function toggleFavorite(playerId: string) {
    setFavorites((current) => {
      const updated = current.includes(playerId) ? current.filter((id) => id !== playerId) : [...current, playerId];
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(updated));
      return updated;
    });
  }

  function exportCalendar() {
    const events = matches.map((match) => {
      const start = toIcsDate(match.date, match.time);
      if (!start) return "";
      return [
        "BEGIN:VEVENT",
        `UID:${match.id}@tsu-ainet.at`,
        `DTSTART:${start}`,
        `DTEND:${start}`,
        `SUMMARY:${escapeIcs(`${match.homeTeam} - ${match.awayTeam}`)}`,
        `LOCATION:${escapeIcs(match.venue)}`,
        "END:VEVENT",
      ].join("\r\n");
    }).filter(Boolean).join("\r\n");
    const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//TSU Ainet//Vereinsapp//DE\r\n${events}\r\nEND:VCALENDAR`;
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "tsu-ainet-spiele.ics";
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("Kalenderdatei wurde erstellt.");
  }

  const [pushTopics, setPushTopics] = useState<PushTopic[]>(() => {
    try { return JSON.parse(localStorage.getItem("tsu-push-topics") || "[\"all\"]"); } catch { return ["all"]; }
  });
  function togglePushTopic(topic: PushTopic) {
    setPushTopics((current) => {
      const next = current.includes(topic) ? current.filter((item) => item !== topic) : [...current, topic];
      localStorage.setItem("tsu-push-topics", JSON.stringify(next));
      return next;
    });
  }
  async function enableNotifications() {
    try {
      await enablePush(pushTopics.length ? pushTopics : ["all"]);
      setMessage("Push-Benachrichtigungen sind auf diesem Gerät aktiv.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Push konnte nicht aktiviert werden.");
    }
  }
  async function disableNotifications() {
    await disablePush();
    setMessage("Push-Benachrichtigungen wurden auf diesem Gerät deaktiviert.");
  }

  return (
    <section className="fan-features">
      <header className="fan-hero">
        <span>TSU Ainet Fanbereich</span>
        <h2>Alles rund um den Verein</h2>
        <p>Statistiken, Favoriten, Live-Spiele, Medien, Kalender, Sponsoren und nützliche Spieltagsfunktionen.</p>
      </header>

      {message && <button className="fan-message" onClick={() => setMessage("")}>{message}</button>}

      <div className="fan-actions">
        <button onClick={exportCalendar}><strong><Icon name="calendar" /> Kalender</strong><span>Spiele als ICS übernehmen</span></button>
        <button onClick={enableNotifications}><strong><Icon name="bell" /> Push aktivieren</strong><span>Nachrichten auf diesem Gerät empfangen</span></button>
        <a href="https://www.google.com/maps/search/?api=1&query=Sportplatz+Ainet" target="_blank" rel="noreferrer"><strong><Icon name="map" /> Navigation</strong><span>Zum Sandgrubenstadion</span></a>
        <a href="https://www.google.com/search?q=Wetter+Ainet" target="_blank" rel="noreferrer"><strong><Icon name="weather" /> Spieltagswetter</strong><span>Aktuelle Prognose öffnen</span></a>
      </div>

      <section className="fan-section push-settings"><div className="fan-title"><h3><Icon name="bell" /> Push-Einstellungen</h3><span>Themen auswählen</span></div><div className="push-topic-grid">{([['all','Alles'],['km','Kampfmannschaft'],['challenge','Challenge'],['u17','U17'],['u12','U12'],['u10','U10'],['u8','U8'],['news','News'],['events','Veranstaltungen'],['results','Ergebnisse']] as Array<[PushTopic,string]>).map(([value,label])=><button key={value} type="button" className={pushTopics.includes(value)?'active':''} onClick={()=>togglePushTopic(value)}>{pushTopics.includes(value)?'✓ ':''}{label}</button>)}</div><div className="push-controls"><button onClick={enableNotifications}><Icon name="bell" /> Aktivieren / aktualisieren</button><button className="secondary" onClick={disableNotifications}>Deaktivieren</button></div><small>Auf iPhone funktioniert Push erst, nachdem die Webapp zum Home-Bildschirm hinzugefügt und von dort geöffnet wurde.</small></section>

      <section className="fan-section">
        <div className="fan-title"><h3>⭐ Lieblingsspieler</h3><span>{favoritePlayers.length} gespeichert</span></div>
        <div className="fan-player-grid">
          {sortedPlayers.slice(0, 24).map((player) => (
            <article className={`fan-player ${favorites.includes(player.id) ? "favorite" : ""}`} key={player.id}>
              {player.imageUrl ? <img src={player.imageUrl} alt={player.name} /> : <div className="fan-avatar">⚽</div>}
              <div><strong>{player.name}</strong><span>{player.position}</span><small>{player.appearances} Spiele · {player.goals} Tore · {player.yellowCards} Gelbe</small></div>
              <button onClick={() => toggleFavorite(player.id)} aria-label="Favorit ändern">{favorites.includes(player.id) ? "★" : "☆"}</button>
            </article>
          ))}
          {!players.length && <p className="fan-empty">Noch keine Kaderdaten vorhanden.</p>}
        </div>
      </section>

      <section className="fan-section">
        <div className="fan-title"><h3>📊 Spielerstatistik</h3><span>aus den Kaderdaten</span></div>
        <div className="fan-table-wrap"><table><thead><tr><th>Spieler</th><th>Spiele</th><th>Tore</th><th>Gelb</th></tr></thead><tbody>{sortedPlayers.slice(0, 20).map((player) => <tr key={player.id}><td>{player.name}</td><td>{player.appearances}</td><td>{player.goals}</td><td>{player.yellowCards}</td></tr>)}</tbody></table></div>
      </section>

      <section className="fan-section">
        <div className="fan-title"><h3>🏟️ Live-Spielmodus & Matchblatt</h3><span>{liveMatches.length ? `${liveMatches.length} live` : "kein Live-Spiel"}</span></div>
        <div className="fan-match-grid">{(liveMatches.length ? liveMatches : nextMatches).map((match) => <article className="fan-match" key={match.id}><span>{match.status || `${match.date} ${match.time}`}</span><strong>{match.homeTeam}</strong><b>{typeof match.homeScore === "number" ? `${match.homeScore} : ${match.awayScore ?? 0}` : "– : –"}</b><strong>{match.awayTeam}</strong><small>{match.venue || "Spielort noch offen"}</small></article>)}{!matches.length && <p className="fan-empty">Noch keine Spieldaten vorhanden.</p>}</div>
      </section>

      <section className="fan-section"><div className="fan-title"><h3>📸 Bildergalerie</h3><span>{gallery.length} Bilder</span></div><div className="fan-media-grid">{gallery.slice(0, 12).map((item) => <a key={item.id} href={item.url} target="_blank" rel="noreferrer"><img src={item.imageUrl || item.url} alt={item.title} /><strong>{item.title}</strong></a>)}{!gallery.length && <p className="fan-empty">Bilder können über die Firestore-Sammlung „gallery“ ergänzt werden.</p>}</div></section>

      <section className="fan-section"><div className="fan-title"><h3>🎥 Videos</h3><span>{videos.length} Videos</span></div><div className="fan-link-grid">{videos.map((item) => <a key={item.id} href={item.url} target="_blank" rel="noreferrer"><span>▶</span><strong>{item.title}</strong></a>)}{!videos.length && <p className="fan-empty">Videos können über die Firestore-Sammlung „videos“ ergänzt werden.</p>}</div></section>

      <section className="fan-section"><div className="fan-title"><h3>🤝 Sponsoren</h3><span>{sponsors.length} Partner</span></div><div className="fan-sponsor-grid">{sponsors.map((sponsor) => sponsor.url ? <a key={sponsor.id} href={sponsor.url} target="_blank" rel="noreferrer">{sponsor.logoUrl ? <img src={sponsor.logoUrl} alt={sponsor.name} /> : null}<strong>{sponsor.name}</strong></a> : <div key={sponsor.id}>{sponsor.logoUrl ? <img src={sponsor.logoUrl} alt={sponsor.name} /> : null}<strong>{sponsor.name}</strong></div>)}</div></section>
    </section>
  );
}
