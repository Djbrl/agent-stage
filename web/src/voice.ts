// Voice prompting with the browser's own speech recognition (Chrome, Edge, Safari). Free, no key; the browser
// sends the audio to its vendor's speech service. Hidden where unsupported (Firefox).
import { useEffect, useRef, useState } from 'react';

const Recognition: any = typeof window !== 'undefined' ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition : null;
export const voiceSupported = Boolean(Recognition);

// onText gets each finished phrase; `interim` is what's being heard right now (shown greyed, not yet in the box).
export function useVoice(onText: (text: string) => void, lang: string) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState('');
  const rec = useRef<any>(null);
  const cb = useRef(onText);
  cb.current = onText;

  const stop = () => { rec.current?.stop(); };
  const start = () => {
    if (!Recognition || rec.current) return;
    const r = new Recognition();
    r.lang = lang; r.continuous = true; r.interimResults = true;
    r.onresult = (e: any) => {
      let live = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) cb.current(t.trim()); else live += t;
      }
      setInterim(live);
    };
    r.onerror = (e: any) => setError(e.error === 'not-allowed' ? (lang.startsWith('fr') ? 'Micro bloqué : autorise-le dans le navigateur.' : 'Microphone blocked: allow it in the browser.') : e.error === 'no-speech' ? '' : `${lang.startsWith('fr') ? 'Voix : ' : 'Voice: '}${e.error}`);
    r.onend = () => { rec.current = null; setListening(false); setInterim(''); };
    rec.current = r; setError(''); setListening(true);
    r.start();
  };
  useEffect(() => () => rec.current?.abort(), []);
  return { listening, interim, error, toggle: () => (rec.current ? stop() : start()), stop };
}
