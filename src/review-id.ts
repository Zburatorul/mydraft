// A review id lives in a URL someone copies, pastes, reads aloud and occasionally
// types, so it is short and unambiguous rather than long and universally unique.
// This server is single-user: it holds few enough reviews that six characters
// collide about never, and ReviewTracker draws again if one ever does.

// 32 characters, so a byte maps on with & 31 and no value is favoured. i, l, o and
// u are absent: the first three are misread as 1 and 0, and the last spells things.
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

export const REVIEW_ID_LENGTH = 6;

export function shortReviewId(length: number = REVIEW_ID_LENGTH): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let id = "";
  for (const byte of bytes) id += ALPHABET[byte & 31];
  return id;
}
