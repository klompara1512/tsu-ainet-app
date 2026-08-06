import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "./firebase";
import "./VisualManager.css";

type HeroImage = {
  id: string;
  imageUrl: string;
  order: number;
  active: boolean;
};

type Team = {
  id: string;
  name: string;
  imageUrl: string;
  order: number;
  active: boolean;
};

async function imageFileToDataUrl(file: File, width: number, height: number) {
  if (!file.type.startsWith("image/")) throw new Error("Bitte eine Bilddatei auswählen.");
  if (file.size > 15 * 1024 * 1024) throw new Error("Das Originalbild darf maximal 15 MB groß sein.");

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Das Bild konnte nicht gelesen werden."));
      element.src = objectUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Das Bild konnte nicht verarbeitet werden.");

    const sourceRatio = image.naturalWidth / image.naturalHeight;
    const targetRatio = width / height;
    let sourceWidth = image.naturalWidth;
    let sourceHeight = image.naturalHeight;
    let sourceX = 0;
    let sourceY = 0;

    if (sourceRatio > targetRatio) {
      sourceWidth = image.naturalHeight * targetRatio;
      sourceX = (image.naturalWidth - sourceWidth) / 2;
    } else {
      sourceHeight = image.naturalWidth / targetRatio;
      sourceY = (image.naturalHeight - sourceHeight) / 2;
    }

    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
    const result = canvas.toDataURL("image/jpeg", 0.74);
    if (result.length > 900_000) throw new Error("Das komprimierte Bild ist noch zu groß. Bitte ein kleineres Bild verwenden.");
    return result;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function VisualManager({ onBack }: { onBack: () => void }) {
  const [heroImages, setHeroImages] = useState<HeroImage[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [savingKey, setSavingKey] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const unsubscribeHero = onSnapshot(
      query(collection(db, "visualAssets"), orderBy("order", "asc")),
      (snapshot) => setHeroImages(snapshot.docs.map((item, index) => {
        const data = item.data();
        return {
          id: item.id,
          imageUrl: typeof data.imageUrl === "string" ? data.imageUrl : "",
          order: typeof data.order === "number" ? data.order : index,
          active: data.active !== false,
        } satisfies HeroImage;
      }).filter((item) => item.imageUrl)),
      () => setError("Die Hintergrundbilder konnten nicht geladen werden."),
    );

    const unsubscribeTeams = onSnapshot(
      query(collection(db, "teams"), orderBy("order", "asc")),
      (snapshot) => setTeams(snapshot.docs.map((item, index) => {
        const data = item.data();
        return {
          id: item.id,
          name: typeof data.name === "string" ? data.name : "Mannschaft",
          imageUrl: typeof data.imageUrl === "string" ? data.imageUrl : "",
          order: typeof data.order === "number" ? data.order : index,
          active: data.active !== false,
        } satisfies Team;
      }).filter((item) => item.active)),
      () => setError("Die Mannschaften konnten nicht geladen werden."),
    );

    return () => {
      unsubscribeHero();
      unsubscribeTeams();
    };
  }, []);

  const activeHeroCount = useMemo(() => heroImages.filter((item) => item.active).length, [heroImages]);

  async function addHeroImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    if (!file) return;
    setSavingKey("hero-new");
    setError("");
    try {
      const imageUrl = await imageFileToDataUrl(file, 1400, 788);
      await addDoc(collection(db, "visualAssets"), {
        kind: "hero",
        imageUrl,
        order: heroImages.length,
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setMessage("Hintergrundbild hinzugefügt.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Das Bild konnte nicht gespeichert werden.");
    } finally {
      setSavingKey("");
    }
  }

  async function toggleHero(image: HeroImage) {
    if (image.active && activeHeroCount <= 1) {
      setError("Mindestens ein aktives Hintergrundbild muss erhalten bleiben.");
      return;
    }
    await updateDoc(doc(db, "visualAssets", image.id), { active: !image.active, updatedAt: serverTimestamp() });
  }

  async function removeHero(image: HeroImage) {
    if (!window.confirm("Dieses Hintergrundbild endgültig löschen?")) return;
    await deleteDoc(doc(db, "visualAssets", image.id));
  }

  async function saveTeamImage(team: Team, file: File | null) {
    if (!file) return;
    setSavingKey(team.id);
    setError("");
    try {
      const imageUrl = await imageFileToDataUrl(file, 1200, 675);
      await updateDoc(doc(db, "teams", team.id), { imageUrl, updatedAt: serverTimestamp() });
      setMessage(`Mannschaftsfoto für ${team.name} gespeichert.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Das Mannschaftsfoto konnte nicht gespeichert werden.");
    } finally {
      setSavingKey("");
    }
  }

  async function removeTeamImage(team: Team) {
    await updateDoc(doc(db, "teams", team.id), { imageUrl: "", updatedAt: serverTimestamp() });
    setMessage(`Mannschaftsfoto für ${team.name} entfernt.`);
  }

  return (
    <section className="visual-manager-page">
      <header className="visual-manager-header">
        <button type="button" onClick={onBack} aria-label="Zurück">‹</button>
        <div><span>Administration</span><h2>Bildverwaltung</h2></div>
        <span />
      </header>

      {message && <div className="visual-manager-message success">{message}</div>}
      {error && <div className="visual-manager-message error">{error}</div>}

      <section className="visual-manager-section">
        <div className="visual-manager-section-head">
          <div><span>Startseite</span><h3>Willkommens-Hintergründe</h3><p>Die aktiven Bilder wechseln automatisch im Hero-Bereich.</p></div>
          <label className="visual-manager-upload">
            {savingKey === "hero-new" ? "Wird gespeichert …" : "+ Bild hinzufügen"}
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={addHeroImage} disabled={Boolean(savingKey)} />
          </label>
        </div>
        <div className="visual-manager-hero-grid">
          {heroImages.length ? heroImages.map((image) => (
            <article key={image.id} className={!image.active ? "inactive" : ""}>
              <img src={image.imageUrl} alt="Willkommens-Hintergrund" />
              <div><button type="button" onClick={() => toggleHero(image)}>{image.active ? "Ausblenden" : "Aktivieren"}</button><button type="button" className="danger" onClick={() => removeHero(image)}>Löschen</button></div>
            </article>
          )) : <div className="visual-manager-empty">Noch kein eigenes Hintergrundbild. Bis dahin wird der vorhandene Fallback verwendet.</div>}
        </div>
      </section>

      <section className="visual-manager-section">
        <div className="visual-manager-section-head"><div><span>Mannschaften</span><h3>Mannschaftsfotos</h3><p>Diese Bilder erscheinen direkt auf den großen Mannschaftskacheln und im Team-Hero.</p></div></div>
        <div className="visual-manager-team-grid">
          {teams.map((team) => (
            <article key={team.id}>
              <div className="visual-manager-team-preview">{team.imageUrl ? <img src={team.imageUrl} alt={team.name} /> : <span>Noch kein Foto</span>}</div>
              <div className="visual-manager-team-info"><strong>{team.name}</strong><small>Empfohlen: Querformat 16:9</small></div>
              <div className="visual-manager-team-actions">
                <label>{savingKey === team.id ? "Wird gespeichert …" : team.imageUrl ? "Foto ersetzen" : "Foto auswählen"}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={Boolean(savingKey)} onChange={(event) => { const file = event.target.files?.[0] || null; event.target.value = ""; void saveTeamImage(team, file); }} /></label>
                {team.imageUrl && <button type="button" onClick={() => removeTeamImage(team)}>Entfernen</button>}
              </div>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

export default VisualManager;
