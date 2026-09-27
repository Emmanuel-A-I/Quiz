/**
 * Avatar helpers shared by admin, student, and display views.
 * A student is either shown as a compressed base64 JPEG photo (photoBase64),
 * or as one of three simple default SVG icons, drawn in the navy/orange palette.
 */

const AVATAR_TYPES = ["boy", "girl", "neutral"];

function _avatarSvgInner(type) {
  // Simple, friendly, flat-shape face icons — no external assets needed.
  if (type === "boy") {
    return `
      <circle cx="50" cy="50" r="50" fill="#1c3757"/>
      <circle cx="50" cy="46" r="20" fill="#ffb677"/>
      <path d="M30 40 Q50 14 70 40 Q70 26 50 22 Q30 26 30 40Z" fill="#142943"/>
      <path d="M22 92 Q28 62 50 62 Q72 62 78 92Z" fill="#ff8a3d"/>
    `;
  }
  if (type === "girl") {
    return `
      <circle cx="50" cy="50" r="50" fill="#1c3757"/>
      <path d="M22 54 Q22 20 50 20 Q78 20 78 54 L78 66 Q70 58 70 46 Q70 30 50 30 Q30 30 30 46 Q30 58 22 66Z" fill="#142943"/>
      <circle cx="50" cy="48" r="18" fill="#ffb677"/>
      <path d="M20 94 Q26 64 50 64 Q74 64 80 94Z" fill="#ff8a3d"/>
    `;
  }
  // neutral
  return `
    <circle cx="50" cy="50" r="50" fill="#1c3757"/>
    <circle cx="50" cy="44" r="19" fill="#ffb677"/>
    <rect x="34" y="22" width="32" height="14" rx="7" fill="#142943"/>
    <path d="M24 92 Q30 62 50 62 Q70 62 76 92Z" fill="#ff8a3d"/>
  `;
}

/** Returns a data URI (SVG) for a given default avatar type. */
function defaultAvatarDataUri(type) {
  const t = AVATAR_TYPES.includes(type) ? type : "neutral";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${_avatarSvgInner(t)}</svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

/**
 * Returns the best image src to display for a student-like record.
 * record: { photoBase64?: string, avatarType?: 'boy'|'girl'|'neutral' }
 */
function avatarSrc(record) {
  if (record && record.photoBase64) return record.photoBase64;
  return defaultAvatarDataUri(record && record.avatarType);
}

/** Builds an <img> element (as HTML string) for a student record. */
function avatarImgHtml(record, sizePx, extraClass) {
  const src = avatarSrc(record);
  const alt = (record && record.name) ? `${record.name}'s avatar` : "Student avatar";
  return `<img class="avatar-img ${extraClass || ""}" src="${src}" alt="${escapeHtml(alt)}" style="width:${sizePx}px;height:${sizePx}px;border-radius:50%;object-fit:cover;border:2px solid var(--navy-500);box-shadow:var(--shadow-sm);">`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}
