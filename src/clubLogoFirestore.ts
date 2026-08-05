import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import type {
  ClubLogoEntry,
  ClubLogoInput,
  ClubLogoSource,
} from "./clubLogoTypes";

export const CLUB_LOGO_COLLECTION = "clubLogos";
export const CLUB_LOGO_SCHEMA_VERSION = 1 as const;

export function normalizeClubLogoName(value: string) {
  return String(value || "")
    .toLocaleLowerCase("de-AT")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/&/g, " und ")
    .replace(/\b(?:tsu|spg|sg|sv|fc|sc|usc|union|sektion|askoe|askö)\b/g, " ")
    .replace(/\b(?:u\s*0?8|u\s*10|u\s*12|u\s*17|1b|ii|reserve|challenge)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value: string) {
  return normalizeClubLogoName(value)
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

export function clubLogoDocumentId(clubName: string) {
  const slug = slugify(clubName);
  if (!slug) {
    throw new Error("Der Vereinsname darf nicht leer sein.");
  }
  return slug;
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  return values
    .map((value) => String(value || "").replace(/\s+/g, " ").trim())
    .filter((value) => {
      if (!value) return false;
      const key = value.toLocaleLowerCase("de-AT");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function readDate(value: unknown) {
  return value instanceof Timestamp ? value.toDate() : null;
}

function readSource(value: unknown): ClubLogoSource {
  return value === "manual-upload" || value === "imported"
    ? value
    : "manual-url";
}

function mapClubLogoDocument(
  id: string,
  data: Record<string, unknown>,
): ClubLogoEntry {
  const clubName = typeof data.clubName === "string" ? data.clubName.trim() : "";
  const aliases = Array.isArray(data.aliases)
    ? uniqueStrings(data.aliases.filter((value): value is string => typeof value === "string"))
    : [];

  return {
    id,
    clubName,
    normalizedName:
      typeof data.normalizedName === "string" && data.normalizedName
        ? data.normalizedName
        : normalizeClubLogoName(clubName),
    aliases,
    normalizedAliases: Array.isArray(data.normalizedAliases)
      ? uniqueStrings(
          data.normalizedAliases.filter(
            (value): value is string => typeof value === "string",
          ),
        )
      : aliases.map(normalizeClubLogoName).filter(Boolean),
    logoUrl: typeof data.logoUrl === "string" ? data.logoUrl : "",
    storagePath: typeof data.storagePath === "string" ? data.storagePath : "",
    source: readSource(data.source),
    active: data.active !== false,
    createdAt: readDate(data.createdAt),
    updatedAt: readDate(data.updatedAt),
    updatedByUid:
      typeof data.updatedByUid === "string" ? data.updatedByUid : "",
    updatedByName:
      typeof data.updatedByName === "string" ? data.updatedByName : "",
    schemaVersion: 1,
  };
}

export function subscribeClubLogos(
  onData: (entries: ClubLogoEntry[]) => void,
  onError?: (message: string) => void,
) {
  const logoQuery = query(
    collection(db, CLUB_LOGO_COLLECTION),
    orderBy("clubName", "asc"),
  );

  return onSnapshot(
    logoQuery,
    (snapshot) => {
      onData(
        snapshot.docs
          .map((item) => mapClubLogoDocument(item.id, item.data()))
          .filter((item) => item.clubName && item.active),
      );
    },
    (error) => {
      console.error("Fehler beim Laden der Logo-Zuordnungen:", error);
      onError?.("Die Vereinslogos konnten nicht geladen werden.");
    },
  );
}

export async function saveClubLogo(input: ClubLogoInput) {
  const clubName = String(input.clubName || "").replace(/\s+/g, " ").trim();
  const aliases = uniqueStrings(input.aliases || []).filter(
    (alias) => alias.toLocaleLowerCase("de-AT") !== clubName.toLocaleLowerCase("de-AT"),
  );
  const normalizedName = normalizeClubLogoName(clubName);
  const normalizedAliases = uniqueStrings(
    aliases.map(normalizeClubLogoName).filter(Boolean),
  );
  const id = clubLogoDocumentId(clubName);
  const reference = doc(db, CLUB_LOGO_COLLECTION, id);

  const existing = await getDoc(reference);

  await setDoc(
    reference,
    {
      clubName,
      normalizedName,
      aliases,
      normalizedAliases,
      logoUrl: String(input.logoUrl || "").trim(),
      storagePath: String(input.storagePath || "").trim(),
      source: input.source || "manual-url",
      active: input.active !== false,
      updatedByUid: String(input.updatedByUid || ""),
      updatedByName: String(input.updatedByName || ""),
      schemaVersion: CLUB_LOGO_SCHEMA_VERSION,
      ...(existing.exists() ? {} : { createdAt: serverTimestamp() }),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  return id;
}

export async function deactivateClubLogo(id: string) {
  await setDoc(
    doc(db, CLUB_LOGO_COLLECTION, id),
    {
      active: false,
      updatedAt: serverTimestamp(),
      schemaVersion: CLUB_LOGO_SCHEMA_VERSION,
    },
    { merge: true },
  );
}

export async function permanentlyDeleteClubLogo(id: string) {
  await deleteDoc(doc(db, CLUB_LOGO_COLLECTION, id));
}

export function resolveManagedClubLogo(
  entries: ClubLogoEntry[],
  teamName: string,
) {
  const normalized = normalizeClubLogoName(teamName);
  if (!normalized) return "";

  const exact = entries.find(
    (entry) =>
      entry.active &&
      Boolean(entry.logoUrl) &&
      (entry.normalizedName === normalized ||
        entry.normalizedAliases.includes(normalized)),
  );
  if (exact) return exact.logoUrl;

  const candidates = entries
    .filter((entry) => entry.active && Boolean(entry.logoUrl))
    .map((entry) => {
      const names = [entry.normalizedName, ...entry.normalizedAliases].filter(Boolean);
      const score = Math.max(
        ...names.map((name) => {
          if (name === normalized) return 100;
          if (normalized.includes(name) || name.includes(normalized)) {
            return Math.min(name.length, normalized.length);
          }
          return 0;
        }),
      );
      return { entry, score };
    })
    .filter((candidate) => candidate.score >= 5)
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.entry.logoUrl || "";
}
