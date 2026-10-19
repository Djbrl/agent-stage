// Online demo only: a one-time card that tells a visitor where they are before anything else.
import { useHealth } from './useHealth';
import { useApp } from './useSettings';
import { useT } from './i18n';

export function PublicWelcome({ onDone }: { onDone: () => void }) {
  const { health } = useHealth();
  const { settings, me } = useApp();
  const t = useT();
  const net = Boolean(me?.internet);
  const live = health && !health.model.mock && health.model.state === 'ok';
  const claude = Boolean(settings?.providers.some((p) => p.id === 'claude'));
  return (
    <div className="modal-back">
      <div className="modal welcome-demo">
        <div className="modal-body">
          <h2>{t('Welcome to the agent-stage live demo', 'Bienvenue dans la démo en ligne d’agent-stage')}</h2>
          <ul>
            <li><b>{t('This is your private sandbox.', 'C’est ton bac à sable privé.')}</b> {t('A fresh container, started just for you on our MacBook (M1) and streamed to your browser. Nobody else sees it.', 'Un conteneur tout neuf, lancé juste pour toi sur notre MacBook (M1) et affiché dans ton navigateur. Personne d’autre ne le voit.')}</li>
            <li><b>{t('Everything is real inside it.', 'Tout y est réel.')}</b> {t('The agent creates and edits files, runs tests and opens pages in its own browser.', 'L’agent crée et modifie des fichiers, lance des tests et ouvre des pages dans son propre navigateur.')} {net
              ? t('It can reach public websites (npm, pip, git clone), but nothing else outside the sandbox.', 'Il peut aller sur les sites publics (npm, pip, git clone), mais rien d’autre hors du bac à sable.')
              : t('It can’t reach the internet or anything outside the sandbox.', 'Il n’a pas accès à internet ni à rien hors du bac à sable.')}</li>
            <li>{claude
              ? <><b>{t('Real models are on.', 'Les vrais modèles sont allumés.')}</b> {t('Claude Sonnet 5.5 does your tasks, with our own agent or with Claude Code', 'Claude Sonnet 5.5 fait tes tâches, avec notre agent ou avec Claude Code')}{live ? t(', and our open model (Qwen3-Coder) on an NVIDIA GPU is on too', ', et notre modèle ouvert (Qwen3-Coder) sur un GPU NVIDIA est allumé aussi') : ''}. {t('Switch in the model menu under the input box.', 'Change-le dans le menu du modèle, sous la zone de saisie.')}</>
              : live ? <><b>{t('The real model is on.', 'Le vrai modèle est allumé.')}</b> {t('An open model (Qwen3-Coder) on our NVIDIA GPU will do your tasks.', 'Un modèle ouvert (Qwen3-Coder) sur notre GPU NVIDIA fera tes tâches.')}</>
              : <><b>{t('The real model is off right now.', 'Le vrai modèle est éteint pour l’instant.')}</b> {t('A scripted demo model plays a fixed example whatever you ask, so you can see how the app works. We turn the GPU on for live tests.', 'Un modèle de démo joue un exemple fixe quoi que tu demandes, pour que tu voies comment marche l’app. On allume le GPU pour les tests en direct.')}</>}</li>
            <li><b>{t('Start here:', 'Pour commencer :')}</b> {t('New session → pick', 'Nouvelle session → choisis')} <i>todo-app</i> {t('or', 'ou')} <i>stats-py</i> {t('(their README has ideas) → describe a task. Watch it on the map, approve its commands, undo anything.', '(leur README donne des idées) → décris une tâche. Suis-la sur la carte, accepte ses commandes, annule ce que tu veux.')}</li>
            <li>{t('The sandbox is deleted 20 minutes after you leave.', 'Le bac à sable est supprimé 20 minutes après ton départ.')}</li>
          </ul>
          <div className="limits">
            <div><b>{t('You can', 'Tu peux')}</b><span>{t('create, edit and delete files · run commands, Node, Python, pytest, git · start a local web server and open it in the agent’s browser', 'créer, modifier et supprimer des fichiers · lancer des commandes, Node, Python, pytest, git · démarrer un serveur web local et l’ouvrir dans le navigateur de l’agent')}{net ? t(' · install packages, clone repos, fetch public websites', ' · installer des paquets, cloner des dépôts, ouvrir des sites publics') : ''} · {t('use Guide me, Just build it, Ask why and Undo', 'utiliser Guide-moi, Fais-le, Pourquoi ? et Annuler')}</span></div>
            <div><b>{t('You can’t', 'Tu ne peux pas')}</b><span>{net ? '' : t('reach the internet (no npm/pip installs, no cloning, no outside websites) · ', 'aller sur internet (pas d’installation npm/pip, pas de clone, pas de sites extérieurs) · ')}{t('reach our laptop or other visitors · change keys or settings', 'atteindre notre ordinateur ou les autres visiteurs · changer les clés ou les réglages')}</span></div>
            <div><b>{t('Limits', 'Limites')}</b><span>{t('1 CPU core · 1.5 GB RAM · 512 MB temporary space · 1 GB of disk (a sandbox that writes more is deleted) · 400k model tokens', '1 cœur CPU · 1,5 Go de RAM · 512 Mo d’espace temporaire · 1 Go de disque (un bac à sable qui écrit plus est supprimé) · 400k tokens de modèle')}{claude ? t(' · $5 of Claude', ' · 5 $ de Claude') : ''} · {t('5 sandboxes at a time', '5 bacs à sable à la fois')}</span></div>
          </div>
        </div>
        <div className="modal-foot"><span style={{ flex: 1 }} /><button className="btn primary" onClick={onDone}>{t('Got it', 'Compris')}</button></div>
      </div>
    </div>
  );
}
