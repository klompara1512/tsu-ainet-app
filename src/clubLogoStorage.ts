import {
  clubLogoFileToDataUrl,
  validateClubLogoImage,
} from "./clubLogoImage";

/**
 * Spark-kompatible Kompatibilitätsschicht.
 *
 * Die Logos werden nicht in Firebase Storage hochgeladen. Stattdessen wird das
 * ausgewählte Bild im Browser verkleinert und als Data-URL zurückgegeben. Diese
 * Data-URL kann direkt im Firestore-Dokument unter `logoUrl` gespeichert werden.
 */
export function validateClubLogoFile(file: File) {
  validateClubLogoImage(file);
}

export async function uploadClubLogoFile(
  file: File,
  _clubName: string,
  _userUid: string,
) {
  validateClubLogoImage(file);

  return {
    logoUrl: await clubLogoFileToDataUrl(file),
    storagePath: "",
  };
}

/**
 * Bei der Spark-Variante existiert keine Datei in Firebase Storage.
 * Die Funktion bleibt als No-op erhalten, damit ältere Aufrufer weiterhin
 * kompilieren und keine Sonderbehandlung benötigen.
 */
export async function deleteClubLogoFile(_storagePath: string) {
  return Promise.resolve();
}