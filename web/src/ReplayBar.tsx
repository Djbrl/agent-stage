// Player bar under the map: rewind any thread and watch the agent walk the project again.
import { useEffect } from 'react';
import type { Replay } from './useAgent';
import { Icon } from './icons';

export function ReplayBar({ replay, running }: { replay: Replay; running: boolean }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || document.querySelector('.modal-back')) return;
      if (e.key === ' ') { e.preventDefault(); replay.playing ? replay.pause() : replay.play(); }
      else if (e.key === 'ArrowLeft') replay.step(-1);
      else if (e.key === 'ArrowRight') replay.step(1);
      else if (e.key === 'Home') replay.seek(0);
      else if (e.key === 'End') replay.live();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  if (replay.total < 2) return null;
  return (
    <div className={`replay ${replay.active ? 'on' : ''}`}>
      <button className="icon-btn" onClick={() => replay.step(-1)} title="Previous step (←)"><Icon name="chevron" size={12} className="flip" /></button>
      <button className="icon-btn play" onClick={() => (replay.playing ? replay.pause() : replay.play())} title="Play / pause (Space)" disabled={running && !replay.active}>
        {replay.playing ? <Icon name="stop" size={11} /> : <Icon name="play" size={12} />}
      </button>
      <button className="icon-btn" onClick={() => replay.step(1)} title="Next step (→)"><Icon name="chevron" size={12} /></button>
      <input type="range" min={0} max={replay.total - 1} value={replay.index} onChange={(e) => replay.seek(Number(e.target.value))} />
      <span className="mono muted">{replay.index + 1}/{replay.total}</span>
      {replay.active
        ? <button className="btn ghost sm live" onClick={replay.live} title="Back to live (End)">● Live</button>
        : <span className="muted replay-hint">Replay</span>}
    </div>
  );
}
