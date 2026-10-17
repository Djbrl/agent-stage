// Light / dark / follow the system. Saved per browser; applied as <html data-theme="light|dark">, which the
// stylesheet and the map palette read. index.html applies it before the first paint, so there's no flash.
import { useEffect, useState } from 'react';

export type ThemePref = 'dark' | 'light' | 'system';
const media = () => window.matchMedia('(prefers-color-scheme: light)');

export function getPref(): ThemePref {
  try { const v = localStorage.getItem('theme'); return v === 'light' || v === 'system' ? v : 'dark'; } catch { return 'dark'; }
}
export function apply(pref = getPref()) {
  const t = pref === 'system' ? (media().matches ? 'light' : 'dark') : pref;
  document.documentElement.dataset.theme = t;
}

export function useTheme(): [ThemePref, (p: ThemePref) => void] {
  const [pref, setPref] = useState(getPref);
  useEffect(() => {
    apply(pref);
    if (pref !== 'system') return;
    const m = media(), on = () => apply('system');
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [pref]);
  return [pref, (p) => { try { localStorage.setItem('theme', p); } catch { /* private mode */ } setPref(p); }];
}
