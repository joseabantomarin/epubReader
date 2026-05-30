const KEY = 'epubreader.readerSettings';

export const DEFAULTS = {
  fontSize: 100,         // percentage, 60–200
  fontFamily: 'system',  // 'system' | 'serif' | 'sans-serif' | 'monospace'
  theme: 'auto',         // 'auto' | 'light' | 'sepia' | 'dark'
  lineHeight: 1.3,       // 1.0–2.2
  hyphenation: true,     // split words at line end (needs lang attr)
  handedness: 'right',   // 'right' | 'left' — which side advances pages
};

export const FONT_FAMILIES = {
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  'sans-serif': '"Helvetica Neue", Arial, sans-serif',
  monospace: 'ui-monospace, "SF Mono", Menlo, monospace',
};

export const THEMES = {
  light: { background: '#ffffff', color: '#1a1a1a' },
  sepia: { background: '#f4ecd8', color: '#000000' },
  dark:  { background: '#14141a', color: '#e8e8e8' },
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function resolveTheme(theme) {
  if (theme === 'auto') {
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return dark ? THEMES.dark : THEMES.light;
  }
  return THEMES[theme] || THEMES.light;
}
