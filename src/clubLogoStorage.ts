import { clubLogoFileToDataUrl, validateClubLogoImage } from "./clubLogoImage";

export function validateClubLogoFile(file: File) {
  validateClubLogoImage(file);
}

/**
 * Spark-kompatibler Upload-Ersatz: Das Logo wird lokal verkleinert und als
 * Data-URL in Firestore gespeichert. Vereinsname und Benutzer-ID bleiben in
 * der Signatur, damit bestehende Aufrufer kompatibel bleiben.
 */
export async function uploadClubLogoFile(
  file: File,
  clubName: string,
  userUid: string,
) {
  void clubName;
  void userUid;
  const logoUrl = await clubLogoFileToDataUrl(file);

  return {
    logoUrl,
    storagePath: "",
  };
}

/**
 * Bei der Spark-Variante existiert keine Datei in Firebase Storage. Die
 * Funktion bleibt als kompatibler No-op erhalten.
 */
export async function deleteClubLogoFile(storagePath: string) {
  void storagePath;
}
