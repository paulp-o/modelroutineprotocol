const SHORT_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const SHORT_ID_MIN_LENGTH = 4;
const SHORT_ID_MAX_LENGTH = 8;
const MAX_ID_RETRIES = 10;

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug.length > 0 ? slug : "routine";
}

function randomShortId(): string {
  const length =
    SHORT_ID_MIN_LENGTH +
    Math.floor(Math.random() * (SHORT_ID_MAX_LENGTH - SHORT_ID_MIN_LENGTH + 1));

  let shortId = "";
  for (let i = 0; i < length; i += 1) {
    const index = Math.floor(Math.random() * SHORT_ID_ALPHABET.length);
    shortId += SHORT_ID_ALPHABET[index];
  }

  return shortId;
}

export function generateRoutineId(name: string, existingIds: string[]): string {
  const slug = slugify(name);
  const used = new Set(existingIds);

  for (let attempt = 0; attempt < MAX_ID_RETRIES; attempt += 1) {
    const candidate = `mrp-${slug}-${randomShortId()}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }

  throw new Error("Failed to generate unique routine ID after 10 retries");
}
