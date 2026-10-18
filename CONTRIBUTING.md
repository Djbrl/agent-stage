# Contributing

Thanks for helping. agent-stage is small on purpose, so please keep changes focused.

## Setup
```bash
npm install
npm start          # http://localhost:3000, mock model, no key needed
```
For UI work with hot reload, run `npm run dev` (server) and `npm run web` (Vite on :5173) side by side.

## Ground rules
- **Node runs the server's TypeScript directly** (type stripping). Don't use parameter
  properties, `enum` or `namespace` in `src/`. `npm run typecheck` catches them.
- **Keep dependencies minimal.** Open an issue before adding one.
- **Safety first.** Tools must stay inside the workspace, and anything that executes code must go
  through `approve()`.
- New tools need: a schema in `toolSchemas`, a case in `runTool`, an icon and label in the UI,
  and a line in `docs/ARCHITECTURE.md`.

## Pull requests
- One topic per PR, with a short description of *why*.
- Include a screenshot or GIF for UI changes.
- Make sure `npm test`, `npm run typecheck` and `npm run build` pass (CI runs all three), and a mock run works
  end to end.
- Tests live in `test/` and use Node's built-in test runner, so there is nothing extra to install. A change to the
  tools, the done-check, git checkpoints or the demo's network filter should come with a test.

## Reporting bugs
Use the bug template. Include the model and provider you used: most agent bugs are model-specific.
