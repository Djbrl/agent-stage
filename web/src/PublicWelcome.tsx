// Online demo only: a one-time card that tells a visitor where they are before anything else.
import { useHealth } from './useHealth';

export function PublicWelcome({ onDone }: { onDone: () => void }) {
  const { health } = useHealth();
  const live = health && !health.model.mock && health.model.state === 'ok';
  return (
    <div className="modal-back">
      <div className="modal welcome-demo">
        <div className="modal-body">
          <h2>Welcome to the agent-stage live demo</h2>
          <ul>
            <li><b>This is your private sandbox.</b> A fresh Docker container, started just for you on our MacBook (M1) and streamed to your browser. Nobody else sees it.</li>
            <li><b>Everything is real inside it.</b> The agent creates and edits files, runs tests and opens pages in its own browser. It can't reach the internet or anything outside the sandbox.</li>
            <li>{live
              ? <><b>The real model is on.</b> An open model (Qwen3-Coder) on our NVIDIA GPU will do your tasks.</>
              : <><b>The real model is off right now.</b> A scripted demo model plays a fixed example whatever you ask, so you can see how the app works. We turn the GPU on for live tests.</>}</li>
            <li><b>Start here:</b> New thread → pick <i>todo-app</i> or <i>stats-py</i> (their README has ideas) → describe a task. Watch it on the map, approve its commands, undo anything.</li>
            <li>The sandbox is deleted 20 minutes after you leave.</li>
          </ul>
          <div className="limits">
            <div><b>You can</b><span>create, edit and delete files · run commands, Node, Python, pytest, git · start a local web server and open it in the agent's browser · use Build, Learn, Ask and Undo</span></div>
            <div><b>You can't</b><span>reach the internet (no npm/pip installs, no cloning, no outside websites) · reach our laptop or other visitors · change models, keys or settings · use the Claude engine</span></div>
            <div><b>Limits</b><span>1 CPU core · 1.5 GB RAM · 512 MB temporary space · disk shared with our laptop, so please keep it under 1 GB · 400k model tokens · 5 sandboxes at a time</span></div>
          </div>
        </div>
        <div className="modal-foot"><span style={{ flex: 1 }} /><button className="btn primary" onClick={onDone}>Got it</button></div>
      </div>
    </div>
  );
}
