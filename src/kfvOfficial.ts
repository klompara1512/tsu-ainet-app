import {
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";

export type KfvWidgetKind = "table" | "fixtures" | "clubFixtures";

export type KfvWidgetConfig = {
  id: string;
  teamName: string;
  kind: KfvWidgetKind;
  title: string;
  url: string;
  enabled: boolean;
};

export type KfvOfficialSettings = {
  widgets: KfvWidgetConfig[];
  refreshMinutes: number;
  updatedAt?: unknown;
};

const SETTINGS_REF = doc(db, "settings", "kfvOfficial");

export const DEFAULT_KFV_WIDGETS: KfvWidgetConfig[] = [
  { id: "km-table", teamName: "Kampfmannschaft", kind: "table", title: "Tabelle Kampfmannschaft", url: "", enabled: true },
  { id: "km-fixtures", teamName: "Kampfmannschaft", kind: "fixtures", title: "Spielplan Kampfmannschaft", url: "", enabled: true },
  { id: "challenge-table", teamName: "Challenge", kind: "table", title: "Tabelle Challenge", url: "", enabled: true },
  { id: "challenge-fixtures", teamName: "Challenge", kind: "fixtures", title: "Spielplan Challenge", url: "", enabled: true },
  { id: "u17-table", teamName: "U17", kind: "table", title: "Tabelle U17", url: "", enabled: true },
  { id: "u17-fixtures", teamName: "U17", kind: "fixtures", title: "Spielplan U17", url: "", enabled: true },
  { id: "u12-fixtures", teamName: "U12", kind: "fixtures", title: "Spielplan U12", url: "", enabled: true },
  { id: "u10-fixtures", teamName: "U10", kind: "fixtures", title: "Spielplan U10", url: "", enabled: true },
  { id: "u8-fixtures", teamName: "U8", kind: "fixtures", title: "Spielplan U8", url: "", enabled: true },
];

export function subscribeKfvOfficialSettings(
  onData: (settings: KfvOfficialSettings) => void,
  onError?: (message: string) => void,
): Unsubscribe {
  return onSnapshot(
    SETTINGS_REF,
    (snapshot) => {
      if (!snapshot.exists()) {
        onData({ widgets: DEFAULT_KFV_WIDGETS, refreshMinutes: 5 });
        return;
      }

      const data = snapshot.data() as Partial<KfvOfficialSettings>;
      onData({
        widgets: Array.isArray(data.widgets) ? data.widgets : DEFAULT_KFV_WIDGETS,
        refreshMinutes:
          typeof data.refreshMinutes === "number" && data.refreshMinutes >= 1
            ? data.refreshMinutes
            : 5,
        updatedAt: data.updatedAt,
      });
    },
    (error) => onError?.(error.message),
  );
}

export async function saveKfvOfficialSettings(
  settings: KfvOfficialSettings,
): Promise<void> {
  await setDoc(
    SETTINGS_REF,
    {
      widgets: settings.widgets,
      refreshMinutes: Math.max(1, Math.round(settings.refreshMinutes || 5)),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export function normalizeWidgetUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  // Erlaubt auch das Einfügen eines vollständigen iframe-Codes und liest src heraus.
  const srcMatch = trimmed.match(/src=["']([^"']+)["']/i);
  return srcMatch?.[1]?.trim() || trimmed;
}
