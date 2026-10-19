// The app's own confirm and notice dialogs, instead of the browser's (which look like a site warning).
// confirmAsk() and notice() can be called from anywhere; <ConfirmHost /> (in App) draws them.
import { useEffect, useState } from 'react';
import { useT } from './i18n';
import { useDismiss } from './dismiss';

type Ask = { title: string; body?: string; ok: string; cancel?: string | null; danger?: boolean; done: (yes: boolean) => void };
let show: ((a: Ask) => void) | null = null;

export const confirmAsk = (o: Omit<Ask, 'done'>) => new Promise<boolean>((done) => (show ? show({ ...o, done }) : done(false)));
export const notice = (title: string, body?: string) => confirmAsk({ title, body, ok: 'OK', cancel: null }).then(() => undefined);

export function ConfirmHost() {
  const [a, setA] = useState<Ask | null>(null);
  useEffect(() => { show = setA; return () => { show = null; }; }, []);
  return a ? <ConfirmModal a={a} close={(yes) => { setA(null); a.done(yes); }} /> : null;
}

function ConfirmModal({ a, close }: { a: Ask; close: (yes: boolean) => void }) {
  const t = useT();
  useDismiss(true, () => close(false));
  return (
    <div className="modal-back" onMouseDown={() => close(false)}>
      <div className="modal confirm-modal" role="alertdialog" aria-label={a.title} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-body">
          <div className="cf-title">{a.title}</div>
          {a.body && <p className="cf-body">{a.body}</p>}
        </div>
        <div className="modal-foot">
          {a.cancel !== null && <button className="btn ghost" onClick={() => close(false)}>{a.cancel ?? t('Cancel', 'Annuler')}</button>}
          <button className={`btn ${a.danger ? 'danger-solid' : 'primary'}`} autoFocus onClick={() => close(true)}>{a.ok}</button>
        </div>
      </div>
    </div>
  );
}
