/**
 * icons.js — tiny inline-SVG line-icon set (Lucide-style), replacing emoji in the UI.
 * Stroke uses currentColor, so icons inherit the text colour of their container.
 */
const svg = (paths, size = 13) =>
  `<svg class="ic" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" ` +
  `stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ` +
  `aria-hidden="true">${paths}</svg>`;

export const ICON = {
  focus:  (s) => svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>', s),
  eye:    (s) => svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>', s),
  eyeOff: (s) => svg('<path d="M9.9 4.2A10 10 0 0 1 12 4c6.5 0 10 7 10 7a15.6 15.6 0 0 1-3 3.7M6 6.5A15.8 15.8 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 4-.8"/><path d="m3 3 18 18"/>', s),
  close:  (s) => svg('<path d="M18 6 6 18M6 6l12 12"/>', s),
  plus:   (s) => svg('<path d="M12 5v14M5 12h14"/>', s),
  box:    (s) => svg('<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="m3 7.5 9 4.5 9-4.5M12 12v9"/>', s),
  image:  (s) => svg('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>', s),
  gallery:(s) => svg('<path d="M3 21h18M4 21V10M20 21V10M3 10l9-6 9 6M8 21v-6M12 21v-6M16 21v-6"/>', s),
  garden: (s) => svg('<path d="M11 20A7 7 0 0 1 4 13C4 8 8 4 20 4c0 8-4 12-9 12Z"/><path d="M4 21c0-4.5 3-7.5 7-8.5"/>', s),
  robot:  (s) => svg('<rect x="4.5" y="8" width="15" height="11" rx="2"/><path d="M12 8V4.5M9.5 4.5h5"/><circle cx="9.5" cy="13" r="1"/><circle cx="14.5" cy="13" r="1"/>', s),
  folder: (s) => svg('<path d="M3 7a2 2 0 0 1 2-2h3.4a2 2 0 0 1 1.4.6L11 7h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', s),
};
