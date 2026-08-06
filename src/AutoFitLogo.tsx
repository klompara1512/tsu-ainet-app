import { useEffect, useState } from "react";

type Props = {
  src: string;
  alt: string;
  className?: string;
  loading?: "eager" | "lazy";
  decoding?: "sync" | "async" | "auto";
  /** Deaktiviert das automatische Zuschneiden, z. B. für breite Kopfsponsor-Logos. */
  trim?: boolean;
};

const MAX_CANVAS_EDGE = 1400;
const WHITE_THRESHOLD = 247;
const ALPHA_THRESHOLD = 12;
const EXTRA_PADDING_RATIO = 0.035;

function isVisiblePixel(data: Uint8ClampedArray, offset: number) {
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  const alpha = data[offset + 3];

  if (alpha <= ALPHA_THRESHOLD) return false;
  return !(red >= WHITE_THRESHOLD && green >= WHITE_THRESHOLD && blue >= WHITE_THRESHOLD);
}

async function createTrimmedLogo(source: string) {
  const image = new Image();
  image.decoding = "async";

  if (!source.startsWith("data:") && !source.startsWith("blob:")) {
    image.crossOrigin = "anonymous";
  }

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Logo konnte nicht geladen werden."));
    image.src = source;
  });

  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  if (!naturalWidth || !naturalHeight) return source;

  const scale = Math.min(1, MAX_CANVAS_EDGE / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return source;

  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;

  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (!isVisiblePixel(pixels, offset)) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  if (right < left || bottom < top) return source;

  const contentWidth = right - left + 1;
  const contentHeight = bottom - top + 1;
  const padding = Math.max(2, Math.round(Math.max(contentWidth, contentHeight) * EXTRA_PADDING_RATIO));
  left = Math.max(0, left - padding);
  top = Math.max(0, top - padding);
  right = Math.min(width - 1, right + padding);
  bottom = Math.min(height - 1, bottom + padding);

  const croppedWidth = right - left + 1;
  const croppedHeight = bottom - top + 1;

  // Nur ersetzen, wenn tatsächlich nennenswert leerer Rand entfernt wird.
  if (croppedWidth / width > 0.94 && croppedHeight / height > 0.94) return source;

  const output = document.createElement("canvas");
  output.width = croppedWidth;
  output.height = croppedHeight;
  const outputContext = output.getContext("2d");
  if (!outputContext) return source;

  outputContext.drawImage(canvas, left, top, croppedWidth, croppedHeight, 0, 0, croppedWidth, croppedHeight);
  return output.toDataURL("image/png");
}

export default function AutoFitLogo({
  src,
  alt,
  className,
  loading = "lazy",
  decoding = "async",
  trim = true,
}: Props) {
  const [trimmedSource, setTrimmedSource] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Breite Logos (z. B. Kopfsponsoren) dürfen nicht automatisch beschnitten
    // werden. Besonders weiße oder sehr helle Logoelemente könnten sonst als
    // leerer Rand erkannt und abgeschnitten werden.
    if (!trim) {
      return () => {
        cancelled = true;
      };
    }

    createTrimmedLogo(src)
      .then((trimmedSource) => {
        if (!cancelled) setTrimmedSource(trimmedSource);
      })
      .catch(() => {
        if (!cancelled) setTrimmedSource(null);
      });

    return () => {
      cancelled = true;
    };
  }, [src, trim]);

  const displaySource = trim ? (trimmedSource ?? src) : src;

  return (
    <img
      src={displaySource}
      alt={alt}
      className={className}
      loading={loading}
      decoding={decoding}
    />
  );
}
