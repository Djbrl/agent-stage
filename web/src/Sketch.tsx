// Scratchpad drawing: a pen over a blank page or over a picture you bring in (a screenshot to mark up).
// The strokes live in the window's state, so shrinking the window keeps them. Sent as one PNG.
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Icon } from './icons';
import { useT } from './i18n';

type Stroke = { color: string; size: number; erase: boolean; pts: [number, number][] };
export type Sketch = { strokes: Stroke[]; bg: string | null; w: number; h: number };
export const emptySketch = (): Sketch => ({ strokes: [], bg: null, w: W, h: Math.round(W / 1.6) });
export const isBlank = (s: Sketch) => !s.bg && !s.strokes.some((x) => !x.erase);

const W = 1400; // drawing width in its own units; the height follows the picture (or 16:10)
const COLORS = ['#141414', '#ff5a1f', '#2f45e8', '#1f9d68'];
const SIZES = [4, 10];

function paint(ctx: CanvasRenderingContext2D, strokes: Stroke[]) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const s of strokes) {
    ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
    ctx.strokeStyle = s.color; ctx.fillStyle = s.color; ctx.lineWidth = s.erase ? s.size * 3 : s.size;
    if (s.pts.length === 1) { ctx.beginPath(); ctx.arc(s.pts[0][0], s.pts[0][1], ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill(); continue; }
    ctx.beginPath(); ctx.moveTo(s.pts[0][0], s.pts[0][1]);
    for (const [x, y] of s.pts.slice(1)) ctx.lineTo(x, y);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}
const loadImg = (src: string) => new Promise<HTMLImageElement>((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; });

// The sketch as one PNG: white page, the picture, then the ink.
export async function sketchToPng(s: Sketch): Promise<string> {
  const ink = document.createElement('canvas'); ink.width = s.w; ink.height = s.h;
  paint(ink.getContext('2d')!, s.strokes);
  const out = document.createElement('canvas'); out.width = s.w; out.height = s.h;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, s.w, s.h);
  if (s.bg) ctx.drawImage(await loadImg(s.bg), 0, 0, s.w, s.h);
  ctx.drawImage(ink, 0, 0);
  return out.toDataURL('image/png');
}

// A picture becomes the page: scaled to the drawing width, at most 2:1 tall.
export async function sketchFromImage(file: Blob, keep: Sketch): Promise<Sketch> {
  const url = await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsDataURL(file); });
  const img = await loadImg(url);
  const h = Math.min(W * 2, Math.round((W * img.naturalHeight) / Math.max(1, img.naturalWidth)));
  return { ...keep, strokes: [], bg: url, w: W, h };
}

export function SketchPad({ value, onChange }: { value: Sketch; onChange: (s: Sketch) => void }) {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [color, setColor] = useState(COLORS[1]);
  const [size, setSize] = useState(SIZES[0]);
  const [erase, setErase] = useState(false);
  const live = useRef<Stroke | null>(null);
  const [over, setOver] = useState(false);

  const redraw = () => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    paint(ctx, live.current ? [...value.strokes, live.current] : value.strokes);
  };
  useEffect(redraw, [value]);

  const at = (e: RPointerEvent): [number, number] => {
    const r = canvas.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * value.w, ((e.clientY - r.top) / r.height) * value.h];
  };
  const down = (e: RPointerEvent) => {
    if (e.button !== 0) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    live.current = { color, size, erase, pts: [at(e)] };
    redraw();
  };
  const move = (e: RPointerEvent) => { if (!live.current) return; live.current.pts.push(at(e)); redraw(); };
  const up = () => { if (!live.current) return; const s = live.current; live.current = null; onChange({ ...value, strokes: [...value.strokes, s] }); };

  const bring = async (f: File | undefined | null) => { if (f && f.type.startsWith('image/')) onChange(await sketchFromImage(f, value)); };
  return (
    <div className="sketch">
      <div className="sketch-tools">
        {COLORS.map((c) => <button key={c} className={`sk-color ${!erase && color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => { setColor(c); setErase(false); }} aria-label={t('Pen colour', 'Couleur du stylo')} />)}
        <span className="sk-sep" />
        {SIZES.map((s) => <button key={s} className={`sk-size ${!erase && size === s ? 'on' : ''}`} onClick={() => { setSize(s); setErase(false); }} aria-label={s === SIZES[0] ? t('Thin pen', 'Stylo fin') : t('Thick pen', 'Stylo épais')}><span style={{ width: s + 2, height: s + 2 }} /></button>)}
        <button className={`sk-btn ${erase ? 'on' : ''}`} onClick={() => setErase(!erase)} title={t('Eraser', 'Gomme')}>{t('Eraser', 'Gomme')}</button>
        <span className="spacer" />
        <button className="sk-btn" disabled={!value.strokes.length} onClick={() => onChange({ ...value, strokes: value.strokes.slice(0, -1) })} title={t('Undo', 'Annuler')}><Icon name="undo" size={13} /></button>
        <button className="sk-btn" disabled={isBlank(value) && !value.strokes.length} onClick={() => onChange(emptySketch())} title={t('Clear the page', 'Effacer la page')}>{t('Clear', 'Effacer')}</button>
        <button className="sk-btn" onClick={() => file.current?.click()} title={t('Bring in a picture to draw on (or paste one)', 'Importer une image pour dessiner dessus (ou en coller une)')}>{t('Picture', 'Image')}</button>
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { void bring(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      <div className={`sketch-page ${over ? 'over' : ''} ${erase ? 'erasing' : ''}`} style={{ aspectRatio: `${value.w} / ${value.h}`, maxWidth: `calc(var(--sketch-max-h, 46vh) * ${(value.w / value.h).toFixed(3)})` }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void bring(e.dataTransfer.files?.[0]); }}>
        {value.bg && <img src={value.bg} alt="" draggable={false} />}
        <canvas ref={canvas} width={value.w} height={value.h} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
        {isBlank(value) && !value.strokes.length && <span className="sketch-hint">{t('Draw here, or drop or paste a screenshot to mark it up', 'Dessine ici, ou dépose ou colle une capture pour l’annoter')}</span>}
      </div>
    </div>
  );
}
