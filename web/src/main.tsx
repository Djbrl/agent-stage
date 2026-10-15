import { Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './style.css';

// A crash while rendering shows what went wrong instead of a black screen.
class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <h2>Something broke on screen.</h2>
        <p className="muted">The agent and your files are fine; this is only the page. Reloading usually fixes it.</p>
        <pre>{String(this.state.error.stack ?? this.state.error).slice(0, 1200)}</pre>
        <button className="btn primary" onClick={() => location.reload()}>Reload</button>
      </div>
    );
  }
}

createRoot(document.getElementById('root')!).render(<Boundary><App /></Boundary>);
