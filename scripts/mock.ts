// npm run mock: the app on the scripted model, with no GPU or tunnel. A script rather than `VAR=x node …` in
// package.json, because npm runs scripts with cmd.exe on Windows, which can't set variables that way.
Object.assign(process.env, { MODEL_API_KEY: 'mock', TUNNEL_HOST: '', BREV_INSTANCE: '', GPU_HOURLY_USD: '0' });
await import('../src/server.ts'); // after the variables: the server reads them as it loads
