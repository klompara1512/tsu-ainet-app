import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "./firebase";
import "./PublicPages.css";

type PersonKind = "board" | "trainer";
type Person = { id: string; name: string; role: string; teamName: string; photoUrl: string; phone: string; email: string; active: boolean; order: number; kind: PersonKind };

export default function PublicPeople({ kind, onBack }: { kind: PersonKind; onBack: () => void }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => onSnapshot(collection(db, "clubPeople"), (snapshot) => {
    setPeople(snapshot.docs.map((item, index) => {
      const data = item.data();
      return {
        id: item.id,
        name: typeof data.name === "string" ? data.name.trim() : "",
        role: typeof data.role === "string" ? data.role.trim() : "",
        teamName: typeof data.teamName === "string" ? data.teamName.trim() : "",
        photoUrl: typeof data.photoUrl === "string" ? data.photoUrl.trim() : "",
        phone: data.publicPhone === false ? "" : typeof data.phone === "string" ? data.phone.trim() : "",
        email: data.publicEmail === false ? "" : typeof data.email === "string" ? data.email.trim() : "",
        active: data.active !== false && data.public !== false,
        order: typeof data.order === "number" ? data.order : index,
        kind: data.kind === "trainer" ? "trainer" : "board",
      } satisfies Person;
    }).filter((item) => item.active && item.name));
    setLoading(false);
  }, () => setLoading(false)), []);

  const visible = useMemo(() => {
    const needle = search.toLocaleLowerCase("de-AT").trim();
    return people
      .filter((item) => item.kind === kind)
      .filter((item) => !needle || [item.name, item.role, item.teamName].join(" ").toLocaleLowerCase("de-AT").includes(needle))
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "de-AT"));
  }, [people, kind, search]);

  const title = kind === "trainer" ? "Trainer" : "Vorstand";
  return (
    <section className="public-page">
      <header className="public-page-head"><button type="button" onClick={onBack}>‹</button><h2>{title}</h2><span /></header>
      <div className="public-people-search"><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, Funktion oder Mannschaft suchen" /></div>
      {loading ? <div className="public-empty">Personen werden geladen …</div> : visible.length ? (
        <div className="public-people-grid">
          {visible.map((person) => (
            <article key={person.id}>
              {person.photoUrl ? <img src={person.photoUrl} alt={person.name} loading="lazy" /> : <div className="public-person-placeholder">{person.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}</div>}
              <h3>{person.name}</h3>
              <p>{person.role}</p>
              {kind === "trainer" && person.teamName && <small className="public-person-team">{person.teamName}</small>}
              <div>{person.phone && <a href={`tel:${person.phone.replace(/\s/g, "")}`}>Anrufen</a>}{person.email && <a href={`mailto:${person.email}`}>E-Mail</a>}</div>
            </article>
          ))}
        </div>
      ) : <div className="public-empty">Keine passenden {title}-Einträge vorhanden.</div>}
    </section>
  );
}
