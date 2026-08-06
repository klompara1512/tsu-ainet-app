import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "./firebase";
import "./PublicPages.css";

type ContactPerson = {
  id: string;
  name: string;
  role: string;
  teamName: string;
  photoUrl: string;
  phone: string;
  email: string;
  publicPhone: boolean;
  publicEmail: boolean;
  order: number;
};

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "TS";
}

export default function PublicClubInfo({ onBack }: { onBack: () => void }) {
  const [contacts, setContacts] = useState<ContactPerson[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => onSnapshot(
    collection(db, "clubPeople"),
    (snapshot) => {
      const rows = snapshot.docs
        .map((item, index) => {
          const data = item.data();
          return {
            id: item.id,
            name: typeof data.name === "string" ? data.name.trim() : "",
            role: typeof data.role === "string" ? data.role.trim() : "",
            teamName: typeof data.teamName === "string" ? data.teamName.trim() : "",
            photoUrl: typeof data.photoUrl === "string" ? data.photoUrl.trim() : "",
            phone: typeof data.phone === "string" ? data.phone.trim() : "",
            email: typeof data.email === "string" ? data.email.trim() : "",
            publicPhone: data.publicPhone !== false,
            publicEmail: data.publicEmail !== false,
            order: typeof data.order === "number" ? data.order : index,
            active: data.active !== false && data.public !== false,
          };
        })
        .filter((person) => person.active && person.name && (
          (person.publicPhone && person.phone) || (person.publicEmail && person.email)
        ))
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "de-AT"));

      setContacts(rows);
      setLoading(false);
    },
    () => {
      setContacts([]);
      setLoading(false);
    },
  ), []);

  const contactCountLabel = useMemo(
    () => contacts.length === 1 ? "1 Kontaktperson" : `${contacts.length} Kontaktpersonen`,
    [contacts.length],
  );

  return (
    <section className="public-page public-club-info-page">
      <header className="public-page-head">
        <button type="button" onClick={onBack} aria-label="Zurück">‹</button>
        <h2>Vereinsinfo</h2>
        <span />
      </header>

      <div className="public-club-info-grid">
        <article className="public-club-address-card">
          <div className="public-club-address-brand">
            <img src="/tsu-ainet-logo.png" alt="TSU Ainet" />
            <div>
              <small>Turn- und Sportunion Ainet</small>
              <h1>TSU Ainet</h1>
            </div>
          </div>

          <dl>
            <div>
              <dt>Adresse</dt>
              <dd>Sportplatz Ainet<br />Ainet, Osttirol</dd>
            </div>
            <div>
              <dt>Heimstätte</dt>
              <dd>Sandgrubenstadion Ainet</dd>
            </div>
          </dl>

          <a
            href="https://www.google.com/maps/search/?api=1&query=Sportplatz+Ainet"
            target="_blank"
            rel="noreferrer"
          >
            Adresse in Google Maps öffnen
          </a>
        </article>

        <section className="public-club-contacts" aria-labelledby="club-contact-title">
          <header>
            <div>
              <small>Ansprechpartner</small>
              <h3 id="club-contact-title">Kontaktpersonen</h3>
            </div>
            {!loading && contacts.length > 0 && <span>{contactCountLabel}</span>}
          </header>

          {loading && <div className="public-empty">Kontaktpersonen werden geladen …</div>}
          {!loading && contacts.length === 0 && (
            <div className="public-empty">
              Aktuell sind noch keine öffentlichen Kontaktdaten eingetragen.
            </div>
          )}

          {!loading && contacts.length > 0 && (
            <div className="public-club-contact-list">
              {contacts.map((person) => (
                <article key={person.id}>
                  {person.photoUrl ? (
                    <img src={person.photoUrl} alt="" />
                  ) : (
                    <div className="public-club-contact-placeholder" aria-hidden="true">
                      {initials(person.name)}
                    </div>
                  )}
                  <div className="public-club-contact-main">
                    <strong>{person.name}</strong>
                    <span>{[person.role, person.teamName].filter(Boolean).join(" · ")}</span>
                    <div className="public-club-contact-actions">
                      {person.publicPhone && person.phone && (
                        <a href={`tel:${person.phone.replace(/\s+/g, "")}`}>Anrufen</a>
                      )}
                      {person.publicEmail && person.email && (
                        <a href={`mailto:${person.email}`}>E-Mail</a>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
