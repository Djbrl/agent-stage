// English / French for interface text. The language is the one picked on the welcome screen (or Settings → Learning).
// Usage: const t = useT(); t('Open a project', 'Ouvrir un projet')
// Code that can't call hooks takes `fr: boolean` and uses tr(fr) the same way.
import { useApp } from './useSettings';

export const useLang = (): 'en' | 'fr' => (useApp().settings?.learn?.language === 'fr' ? 'fr' : 'en');
export const tr = (fr: boolean) => (en: string, frText: string) => (fr ? frText : en);
export function useT() {
  return tr(useLang() === 'fr');
}

// The two modes. Internal values stay 'learn' | 'build'.
export const modeName = (m: 'learn' | 'build', fr: boolean) => (m === 'learn' ? (fr ? 'Guide-moi' : 'Guide me') : (fr ? 'Fais-le' : 'Just build it'));

// The server's own messages (stopped, errors from Undo / Save this version, etc.) are written in English and saved
// in the thread; they're put into the reader's language when shown.
const SERVER: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^Stopped by you$/, () => 'Arrêté par toi'],
  [/^Stopped: reached the step limit \((\d+) steps\)/, (m) => `Arrêté : limite de ${m[1]} étapes atteinte. Envoie « continue » pour reprendre.`],
  [/^Stop the agent first\.?$/, () => 'Arrête d’abord l’agent.'],
  [/^(agent is busy|The agent is already working)/, () => 'L’agent est déjà au travail. Attends qu’il ait fini, ou arrête-le.'],
  [/^This task changed no files$/, () => 'Cette tâche n’a modifié aucun fichier.'],
  [/^This task has no record of its changes$/, () => 'Cette tâche n’a pas gardé de trace de ses changements.'],
  [/^Nothing to (keep|save): /, () => 'Rien à garder : cette version est déjà enregistrée.'],
  [/^Could not write the summary\. Try again, or (clear|start fresh) instead\.$/, () => 'Impossible d’écrire le résumé. Réessaie, ou repars de zéro.'],
  [/^Could not reach the server$/, () => 'Impossible de joindre le serveur. Vérifie que Codetandem tourne encore.'],
  [/^Not available in the online demo$/, () => 'Pas disponible dans la démo en ligne.'],
  [/^This is a shared session/, () => 'C’est une session partagée : tu peux la revoir, pas la lancer. Crée une nouvelle session pour travailler sur ton projet.'],
  [/^This is not a Codetandem session file\.$/, () => 'Ce n’est pas un fichier de session Codetandem.'],
  [/^This session file comes from a newer Codetandem/, () => 'Ce fichier vient d’une version plus récente de Codetandem. Mets l’app à jour pour l’ouvrir.'],
  [/^The session file has no readable steps\.$/, () => 'Ce fichier de session ne contient aucune étape lisible.'],
  [/^This session file is too big to open/, () => 'Ce fichier de session est trop gros (plus de 40 Mo).'],
];
export function serverText(msg: string, fr: boolean): string {
  if (!fr) return msg;
  for (const [re, f] of SERVER) { const m = msg.match(re); if (m) return f(m); }
  // The done-check's note at the end of a reply ("`npm test` still fails after 3 tries. Over to you.").
  return msg.replace(/> ⚠ (`[^`]+`) still fails after (\d+) tries\. Over to you\./, '> ⚠ $1 échoue encore après $2 essais. À toi de jouer.');
}
