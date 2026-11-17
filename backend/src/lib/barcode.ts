// Barcode normalization (pure). Check digits are deliberately NOT validated.

/**
 * Strips non-digits. 12 (UPC-A) → "0" + code; 13 stays; 14 with a leading "0" drops it;
 * 8 (EAN-8) stays. Other lengths → null. A 14-digit code without a leading "0"
 * (a GTIN-14 case/pack code) has no EAN-13 form and is kept as is.
 */
export function normalizeBarcode(raw: string): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  switch (d.length) {
    case 8:
    case 13:
      return d;
    case 12:
      return "0" + d;
    case 14:
      return d.startsWith("0") ? d.slice(1) : d;
    default:
      return null;
  }
}
