import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "./firebase";
import AutoFitLogo from "./AutoFitLogo";
import "./PublicPages.css";

type Sponsor = { id: string; name: string; logoUrl: string; website: string; active: boolean; order: number };

export default function PublicSponsors({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<Sponsor[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => onSnapshot(collection(db, "sponsors"), (snapshot) => {
    setItems(snapshot.docs.map((item, index) => {
      const data = item.data();
      return {
        id: item.id,
        name: typeof data.name === "string" ? data.name.trim() : "Sponsor",
        logoUrl: typeof data.logoUrl === "string" ? data.logoUrl.trim() : "",
        website: typeof data.website === "string" ? data.website.trim() : "",
        active: data.active !== false,
        order: typeof data.order === "number" ? data.order : index,
      };
    }).filter((item) => item.active && item.name));
    setLoading(false);
  }, () => setLoading(false)), []);

  const sponsors = useMemo(() => [...items].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "de-AT")), [items]);

  return <section className="public-page">
    <header className="public-page-head"><button type="button" onClick={onBack}>‹</button><h2>Sponsoren</h2><span /></header>
    {loading ? <div className="public-empty">Sponsoren werden geladen …</div> : sponsors.length ? (
      <div className="public-sponsor-grid">{sponsors.map((sponsor) => {
        const content = <>{sponsor.logoUrl ? <AutoFitLogo src={sponsor.logoUrl} alt={sponsor.name} className="public-sponsor-logo" /> : <strong>{sponsor.name}</strong>}<span>{sponsor.name}</span></>;
        return sponsor.website ? <a key={sponsor.id} href={sponsor.website} target="_blank" rel="noreferrer">{content}</a> : <div key={sponsor.id}>{content}</div>;
      })}</div>
    ) : <div className="public-empty">Aktuell sind noch keine Sponsoren eingetragen.</div>}
  </section>;
}
