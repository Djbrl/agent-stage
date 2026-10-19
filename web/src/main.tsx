import { Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './style.css';
import { apply, getPref } from './theme';

// "System" theme follows the computer even while Settings is closed.
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (getPref() === 'system') apply(); });

// A crash while rendering shows what went wrong instead of a black screen.
class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    const fr = navigator.language?.toLowerCase().startsWith('fr');
    return (
      <div className="crash">
        <h2>{fr ? 'Un souci d’affichage.' : 'Something broke on screen.'}</h2>
        <p className="muted">{fr ? 'L’agent et tes fichiers vont bien : c’est seulement la page. Recharger règle souvent le problème.' : 'The agent and your files are fine; this is only the page. Reloading usually fixes it.'}</p>
        <pre>{String(this.state.error.stack ?? this.state.error).slice(0, 1200)}</pre>
        <button className="btn primary" onClick={() => location.reload()}>{fr ? 'Recharger' : 'Reload'}</button>
      </div>
    );
  }
}

createRoot(document.getElementById('root')!).render(<Boundary><App /></Boundary>);
