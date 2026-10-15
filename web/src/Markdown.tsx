// Just enough markdown for agent replies: paragraphs, lists, **bold**, *italic*, `code`, ``` blocks.
// Builds React elements (no innerHTML), so model output can't inject markup.
import type { ReactNode } from 'react';
import { useHighlight } from './highlight';

function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*.+?\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0, m: RegExpExecArray | null, i = key;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('`')) out.push(<Code key={i++} text={t.slice(1, -1)} />);
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
      // Lists, with nesting by indentation (models often emit "1. Heading" then indented "- item").
      const items: { depth: number; ordered: boolean; text: string }[] = [];
      for (; i < lines.length && (/^\s*([-*]|\d+\.)\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length)); i++) {
        const m = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        if (m) items.push({ depth: Math.floor(m[1].replace(/\t/g, '  ').length / 2), ordered: /\d/.test(m[2]), text: m[3] });
        else items[items.length - 1].text += ' ' + lines[i].trim();
      }
      blocks.push(<ListTree key={blocks.length} items={items} />);
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

// A code span that names a project file is a link to the map: hover it to see where it is.
function Code({ text }: { text: string }) {
  const h = useHighlight();
  const path = h.known(text);
  if (!path) return <code>{text}</code>;
  return <code className="filelink" onMouseEnter={() => h.set([path])} onMouseLeave={() => h.set(null)}>{text}</code>;
}

function ListTree({ items }: { items: { depth: number; ordered: boolean; text: string }[] }) {
  // Build a tree from depths, then render nested <ol>/<ul>.
  type N = { text: string; ordered: boolean; kids: N[] };
  const root: N = { text: '', ordered: false, kids: [] };
  const stack: { depth: number; node: N }[] = [{ depth: -1, node: root }];
  for (const it of items) {
    while (stack.length > 1 && stack[stack.length - 1].depth >= it.depth) stack.pop();
    const n: N = { text: it.text, ordered: it.ordered, kids: [] };
    stack[stack.length - 1].node.kids.push(n);
    stack.push({ depth: it.depth, node: n });
  }
  const render = (kids: N[], k: string): ReactNode => {
    const L = kids[0]?.ordered ? 'ol' : 'ul';
    return <L key={k} className="md-list">{kids.map((n, j) => <li key={j}>{inline(n.text)}{n.kids.length ? render(n.kids, `${k}-${j}`) : null}</li>)}</L>;
  };
  return <>{render(root.kids, 'l')}</>;
}
