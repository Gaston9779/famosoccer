/**
 * Analysis-only identity aid. It intentionally does not establish identity
 * and must never be used by itself to merge Player records.
 */
const cyrillicToLatin: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh",
  з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts",
  ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "y", ь: "", э: "e", ю: "yu",
  я: "ya", қ: "q", ғ: "g", ҳ: "h", ў: "o",
};

export function normalizePersonName(value: string | null | undefined) {
  if (!value) return "";
  const latin = value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[а-яёўқғҳ]/g, (char) => cyrillicToLatin[char] ?? char);
  return latin
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[’'`ʻʼʹ]/g, "")
    .replace(/[‐‑‒–—-]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Preserves every token while making harmless space joins comparable. */
export function compactNameSignature(value: string | null | undefined) {
  return normalizePersonName(value).replace(/\s/g, "");
}

/** Token boundaries are retained for audit output; no name token is discarded. */
export function tokenSignature(value: string | null | undefined) {
  return normalizePersonName(value).split(" ").filter(Boolean).join("|");
}

/** Handles frequent Latin transliteration substitutions for similarity only. */
export function transliterationSignature(value: string | null | undefined) {
  return compactNameSignature(value)
    .replace(/kh/g, "h")
    .replace(/x/g, "h")
    .replace(/zh/g, "j")
    .replace(/yev/g, "ev")
    .replace(/ye/g, "e")
    .replace(/ts/g, "s");
}

function levenshtein(left: string, right: string) {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    const current = [i];
    for (let j = 1; j <= right.length; j++)
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    previous = current;
  }
  return previous[right.length];
}

export function nameSimilarity(left: string | null | undefined, right: string | null | undefined) {
  const a = transliterationSignature(left);
  const b = transliterationSignature(right);
  if (!a || !b) return 0;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}
