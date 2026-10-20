// Turning on version history (Git) for a folder: what it is, what will happen, and big files left out.
import { useEffect, useState } from 'react';
import { Icon } from './icons';
import { useT } from './i18n';
import { useDismiss } from './dismiss';

type Plan = { installed: boolean; files: number; bigCount: number; bigMb: number; bigExamples: { path: string; mb: number }[]; limitMb: number };

export function GitSetup({ threadId, onDone, onClose }: { threadId: string; onDone: () => void; onClose: () => void }) {
  const t = useT();
  useDismiss(true, onClose);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [skipBig, setSkipBig] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { fetch(`/api/threads/${threadId}/git/plan`).then((r) => r.json()).then(setPlan).catch(() => setErr(t('Could not look at the folder.', 'Impossible de lire le dossier.'))); }, [threadId]);
  const go = async () => {
    setBusy(true); setErr('');
    const r = await fetch(`/api/threads/${threadId}/git/init`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ skipBig }) }).catch(() => null);
    const j = await r?.json().catch(() => null);
    if (r?.ok && j?.repo) onDone();
    else { setErr(j?.error ?? t('Git could not be set up.', 'Git n’a pas pu être configuré.')); setBusy(false); }
  };
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal git-setup" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head"><span>{t('Keep versions with Git', 'Garder des versions avec Git')}</span><button className="icon-btn" onClick={onClose} aria-label={t('Close', 'Fermer')}><Icon name="x" size={13} /></button></div>
        <div className="modal-body">
          <p className="gs-lead">{t('Git saves versions of your files. Tandemcode saves one before every task, so Undo can put your files back if the agent gets something wrong.', 'Git garde des versions de tes fichiers. Tandemcode en garde une avant chaque tâche, pour qu’Annuler remette tes fichiers si l’agent se trompe.')}</p>
          <p className="muted gs-small">{t('Nothing is uploaded. The versions stay in this folder, in a hidden .git folder.', 'Rien n’est envoyé. Les versions restent dans ce dossier, dans un dossier caché .git.')}</p>
          {!plan ? <div className="muted">{t('Looking at the folder…', 'Je regarde le dossier…')}</div> : <div className="gs-checks">
            <div className={`check ${plan.installed ? 'ok' : 'no'}`}><span className="check-dot"><Icon name={plan.installed ? 'check' : 'x'} size={11} /></span>
              <span>{plan.installed ? t('Git is installed', 'Git est installé') : <>{t('Git isn’t installed.', 'Git n’est pas installé.')} <a href="https://git-scm.com/downloads" target="_blank" rel="noreferrer">{t('Get it here', 'Le télécharger')}</a></>}</span></div>
            <div className="check ok"><span className="check-dot"><Icon name="check" size={11} /></span>
              <span>{plan.files ? t(`${plan.files} file${plan.files > 1 ? 's' : ''} get${plan.files > 1 ? '' : 's'} a first version`, `${plan.files} fichier${plan.files > 1 ? 's reçoivent' : ' reçoit'} une première version`) : t('The folder is empty: versions start with the first change', 'Le dossier est vide : les versions commencent au premier changement')}</span></div>
            {plan.bigCount > 0 && (
              <label className="gs-big">
                <input type="checkbox" checked={skipBig} onChange={(e) => setSkipBig(e.target.checked)} />
                <span>{t(`Leave out ${plan.bigCount} big file${plan.bigCount > 1 ? 's' : ''} (${plan.bigMb} MB in all, each over ${plan.limitMb} MB)`, `Laisser de côté ${plan.bigCount} gros fichier${plan.bigCount > 1 ? 's' : ''} (${plan.bigMb} Mo en tout, chacun plus de ${plan.limitMb} Mo)`)}
                  <span className="muted">{plan.bigExamples.map((b) => b.path.split('/').pop()).join(', ')}{plan.bigCount > plan.bigExamples.length ? '…' : ''}. {t('Recommended: Git is slow with big art and video files. They are listed in .gitignore and stay as they are.', 'Conseillé : Git est lent avec les gros fichiers d’image et de vidéo. Ils sont listés dans .gitignore et ne bougent pas.')}</span>
                </span>
              </label>
            )}
          </div>}
          {err && <p className="problem">{err}</p>}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>{t('Not now', 'Pas maintenant')}</button>
          <button className="btn primary" disabled={!plan?.installed || busy} onClick={go}>{busy ? t('Setting up…', 'Configuration…') : t('Set up Git', 'Configurer Git')}</button>
        </div>
      </div>
    </div>
  );
}
