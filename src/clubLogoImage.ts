const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const MAX_DATA_URL_LENGTH = 700_000;
const TARGET_SIZE = 256;

const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function validateClubLogoImage(file: File) {
  if (!ACCEPTED_TYPES.has(file.type)) {
    throw new Error("Bitte eine PNG-, JPG- oder WebP-Datei auswählen.");
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error("Die Bilddatei darf höchstens 4 MB groß sein.");
  }
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Das Bild konnte nicht gelesen werden."));
    };
    image.src = objectUrl;
  });
}

/**
 * Verkleinert ein Logo im Browser auf maximal 256 × 256 Pixel und speichert es
 * als kompaktes WebP-Data-URL. Damit ist kein Firebase Storage erforderlich.
 */
export async function clubLogoFileToDataUrl(file: File) {
  validateClubLogoImage(file);
  const image = await loadImage(file);

  const scale = Math.min(TARGET_SIZE / image.naturalWidth, TARGET_SIZE / image.naturalHeight, 1);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = TARGET_SIZE;
  canvas.height = TARGET_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Das Bild konnte nicht verarbeitet werden.");

  context.clearRect(0, 0, TARGET_SIZE, TARGET_SIZE);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  const x = Math.round((TARGET_SIZE - width) / 2);
  const y = Math.round((TARGET_SIZE - height) / 2);
  context.drawImage(image, x, y, width, height);

  let dataUrl = canvas.toDataURL("image/webp", 0.82);
  if (!dataUrl.startsWith("data:image/webp")) {
    dataUrl = canvas.toDataURL("image/png");
  }
  if (dataUrl.length > MAX_DATA_URL_LENGTH) {
    dataUrl = canvas.toDataURL("image/webp", 0.62);
  }
  if (dataUrl.length > MAX_DATA_URL_LENGTH) {
    throw new Error("Das Logo ist trotz Komprimierung zu groß. Bitte ein einfacheres oder kleineres Bild verwenden.");
  }
  return dataUrl;
}
