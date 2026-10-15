// Just enough markdown for agent replies: paragraphs, lists, **bold**, *italic*, `code`, ``` blocks.
// Builds React elements (no innerHTML), so model output can't inject markup.
import type { ReactNode } from 'react';

function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*.+?\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0, m: RegExpExecArray | null, i = key;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('`')) out.push(<code key={i++}>{t.slice(1, -1)}</code>);
    else if (t.startsWith('**')) out.push(<strong key={i++}>{inline(t.slice(2, -2), i * 100)}</strong>);
    else out.push(<em key={i++}>{inline(t.slice(1, -1), i * 100)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const CALLOUT = /^✦\s*(Build checkpoint|Design checkpoint|Implementation checkpoint|Implementation report|System check|Concept|Why this matters)\s*:?\s*(.*)$/i;

// Learn-mode callouts ("✦ Concept: closures" + the paragraphs until the next callout) get their own card.
export function Markdown({ text }: { text: string }) {
  const parts = text.split(/\n(?=✦)/);
  if (parts.length === 1 && !CALLOUT.test(text.trim())) return <Plain text={text} />;
  return <div className="md">{parts.map((part, i) => {
    const [first, ...rest] = part.trim().split('\n');
    const m = first.match(CALLOUT);
    if (!m) return <Plain key={i} text={part} />;
    const kind = m[1].toLowerCase().replace(/\s+/g, '-');
    return (
      <div key={i} className={`callout ${kind}`}>
        <div className="callout-head">✦ {m[1]}{m[2] ? <span>: {m[2]}</span> : null}</div>
        {rest.join('\n').trim() && <Plain text={rest.join('\n')} />}
      </div>
    );
  })}</div>;
}

function Plain({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) body.push(lines[i]);
      i++;
      blocks.push(<pre key={blocks.length} className="md-pre">{body.join('\n')}</pre>);
    } else if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      for (; i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]); i++) items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''));
      const List = ordered ? 'ol' : 'ul';
      blocks.push(<List key={blocks.length} className="md-list">{items.map((t, j) => <li key={j}>{inline(t)}</li>)}</List>);
    } else if (/^#{1,4}\s/.test(line)) {
      blocks.push(<p key={blocks.length} className="md-h">{inline(line.replace(/^#+\s/, ''))}</p>);
      i++;
    } else if (!line.trim()) {
      i++;
    } else {
      const para: string[] = [];
      for (; i < lines.length && lines[i].trim() && !/^(\s*([-*]|\d+\.)\s+|```|#{1,4}\s)/.test(lines[i]); i++) para.push(lines[i]);
      blocks.push(<p key={blocks.length}>{inline(para.join(' '))}</p>);
    }
  }
  return <div className="md">{blocks}</div>;
}
