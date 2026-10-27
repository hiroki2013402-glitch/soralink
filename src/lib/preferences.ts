// Settings that belong to this browser only (not to the account). Stored locally.
export type Prefs = { reduceMotion: boolean };

const KEY = "soralink:prefs";
const DEFAULTS: Prefs = { reduceMotion: false };

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(prefs: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Private browsing can refuse storage. The choice still applies for this visit.
  }
  applyPrefs(prefs);
}

// Puts the choices on the page as classes, so the stylesheet can respond to them.
export function applyPrefs(prefs: Prefs = loadPrefs()) {
  document.documentElement.classList.toggle("reduce-motion", prefs.reduceMotion);
}
