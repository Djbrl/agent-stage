// English / French for interface text. The language is the one chosen for Learn mode (Settings → Learning).
// Usage: const t = useT(); t('Open a project', 'Ouvrir un projet')
import { useApp } from './useSettings';

export const useLang = (): 'en' | 'fr' => (useApp().settings?.learn?.language === 'fr' ? 'fr' : 'en');
export function useT() {
  const fr = useLang() === 'fr';
  return (en: string, frText: string) => (fr ? frText : en);
}
