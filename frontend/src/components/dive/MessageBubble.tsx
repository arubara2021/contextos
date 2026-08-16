import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon } from "../shared/Icon";
import type { ChatMessage } from "../../types";
import { formatClock } from "../../utils/date";

interface MessageBubbleProps {
  message: ChatMessage;
}

interface ParseContext {
  id: number;
  block: number;
}

interface ListItem {
  content: string;
  nested: ReactNode;
}

interface CodeMeta {
  lang: string;
  body: string;
}

const INLINE_RE =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*|_[^_\n]+_)|(\[[^\]\n]+\]\([^)\n]+\))/g;
const LIST_RE = /^(\s*)([-*+]|(\d+)[.)])\s+(.*)$/;
const HR_RE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const TERM_RE = /^([^*`[\]:]{2,46}):\s+([\s\S]*)$/;
const FRESH_WINDOW_MS = 8000;
const REVEAL_MS = 1700;

function legacyCopy(text: string, done: () => void): void {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
    done();
  } finally {
    document.body.removeChild(ta);
  }
}

function copyToClipboard(text: string, done: () => void): void {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => legacyCopy(text, done));
    return;
  }
  legacyCopy(text, done);
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = (event: React.MouseEvent) => {
    event.stopPropagation();
    copyToClipboard(text, () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  };
  return (
    <button
      type="button"
      className={`msg-copy${copied ? " is-copied" : ""}`}
      onClick={onCopy}
      aria-label={copied ? "Copied" : "Copy message"}
      title={copied ? "Copied" : "Copy"}
    >
      <Icon name={copied ? "check" : "copy"} size={13} />
      <span>{copied ? "copied" : "copy"}</span>
    </button>
  );
}

function delayFor(ctx: ParseContext): string {
  return `${Math.min(ctx.block++, 12) * 45}ms`;
}

function listInfo(line: string): { indent: number; ordered: boolean; content: string } | null {
  const m = line.match(LIST_RE);
  if (!m) return null;
  const spaces = m[1].replace(/\t/g, "  ");
  return { indent: spaces.length, ordered: m[3] !== undefined, content: m[4] };
}

function isBlockStart(line: string): boolean {
  const t = line.trim();
  if (t === "") return true;
  if (/^```/.test(t)) return true;
  if (/^#{1,6}\s/.test(t)) return true;
  if (/^>\s?/.test(t)) return true;
  if (HR_RE.test(line)) return true;
  if (listInfo(line)) return true;
  return false;
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(<Fragment key={`t${i}`}>{text.slice(last, m.index)}</Fragment>);
    }
    const tok = m[0];
    if (m[1]) {
      nodes.push(<code key={`c${i}`}>{tok.slice(1, -1)}</code>);
    } else if (m[2]) {
      nodes.push(<strong key={`b${i}`}>{tok.slice(2, -2)}</strong>);
    } else if (m[3]) {
      nodes.push(<em key={`e${i}`}>{tok.slice(1, -1)}</em>);
    } else if (m[4]) {
      const lm = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (lm) {
        nodes.push(
          <a key={`a${i}`} href={lm[2]} target="_blank" rel="noreferrer noopener">
            {lm[1]}
          </a>
        );
      } else {
        nodes.push(<Fragment key={`t${i}`}>{tok}</Fragment>);
      }
    }
    last = m.index + tok.length;
    i++;
  }
  if (last < text.length) {
    nodes.push(<Fragment key={`t${i}e`}>{text.slice(last)}</Fragment>);
  }
  return nodes;
}

function renderItem(content: string): ReactNode[] {
  const m = content.match(TERM_RE);
  if (m && m[1].trim().length >= 2) {
    return [
      <strong key="term" className="md-term">
        {m[1].trim()}:
      </strong>,
      <span key="sp"> </span>,
      ...renderInline(m[2]),
    ];
  }
  return renderInline(content);
}

function buildList(
  ordered: boolean,
  items: ListItem[],
  ctx: ParseContext,
  delay: string | undefined
): ReactNode {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag key={`l${ctx.id++}`} style={delay ? { animationDelay: delay } : undefined}>
      {items.map((it, idx) => (
        <li key={`i${idx}`}>
          {renderItem(it.content)}
          {it.nested}
        </li>
      ))}
    </Tag>
  );
}

function parseList(
  lines: string[],
  start: number,
  baseIndent: number,
  ctx: ParseContext,
  delay: string | undefined
): { node: ReactNode; next: number } {
  const first = listInfo(lines[start]);
  const ordered = first ? first.ordered : false;
  const items: ListItem[] = [];
  let i = start;
  while (i < lines.length) {
    const info = listInfo(lines[i]);
    if (!info) break;
    if (info.indent < baseIndent) break;
    if (info.indent > baseIndent) {
      if (items.length === 0) {
        items.push({ content: info.content, nested: null });
        i++;
        continue;
      }
      const sub = parseList(lines, i, info.indent, ctx, undefined);
      items[items.length - 1].nested = sub.node;
      i = sub.next;
      continue;
    }
    if (info.ordered !== ordered) break;
    items.push({ content: info.content, nested: null });
    i++;
  }
  return { node: buildList(ordered, items, ctx, delay), next: i };
}

function skipList(lines: string[], start: number, baseIndent: number, ordered: boolean): number {
  let i = start;
  while (i < lines.length) {
    const info = listInfo(lines[i]);
    if (!info) break;
    if (info.indent < baseIndent) break;
    if (info.indent === baseIndent && info.ordered !== ordered) break;
    i++;
  }
  return i;
}

function normalizeLines(raw: string[]): string[] {
  const out: string[] = [];
  let inSub = false;
  let fence = false;
  for (const line of raw) {
    const fixed = line.replace(/\t/g, "  ");
    const t = fixed.trim();
    if (/^```/.test(t)) {
      fence = !fence;
      out.push(fixed);
      continue;
    }
    if (fence) {
      out.push(fixed);
      continue;
    }
    const ord = /^\d+\.\s/.test(fixed);
    const unord = /^[-*+]\s/.test(fixed);
    if (ord) {
      inSub = true;
      out.push(fixed);
    } else if (unord && inSub) {
      out.push(`  ${fixed}`);
    } else {
      inSub = false;
      out.push(fixed);
    }
  }
  return out;
}

function segmentContent(content: string): string[] {
  const lines = normalizeLines(content.split("\n"));
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (t === "") {
      i++;
      continue;
    }
    if (/^```/.test(t)) {
      const buf = [line];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        buf.push(lines[i]);
        i++;
      }
      if (i < lines.length) {
        buf.push(lines[i]);
        i++;
      }
      out.push(buf.join("\n"));
      continue;
    }
    if (HR_RE.test(line)) {
      out.push(line);
      i++;
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      out.push(line);
      i++;
      continue;
    }
    if (/^>\s?/.test(t)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      out.push(buf.join("\n"));
      continue;
    }
    const li = listInfo(line);
    if (li) {
      const start = i;
      i = skipList(lines, i, li.indent, li.ordered);
      out.push(lines.slice(start, i).join("\n"));
      continue;
    }
    const buf = [line];
    while (i + 1 < lines.length && lines[i + 1].trim() !== "" && !isBlockStart(lines[i + 1])) {
      i++;
      buf.push(lines[i]);
    }
    i++;
    out.push(buf.join("\n"));
  }
  return out;
}

function codeMeta(raw: string): CodeMeta | null {
  if (!/^```/.test(raw.trim())) return null;
  const lines = raw.split("\n");
  const head = lines[0].trim();
  const lm = head.match(/^```(\w*)/);
  const lang = (lm && lm[1]) || "";
  const last = lines.length - 1;
  const hasClose = last > 0 && /^```/.test(lines[last].trim());
  const bodyLines = hasClose ? lines.slice(1, last) : lines.slice(1);
  return { lang, body: bodyLines.join("\n") };
}

function parseBlocks(content: string): ReactNode[] {
  const ctx: ParseContext = { id: 0, block: 0 };
  const lines = normalizeLines(content.split("\n"));
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (t === "") {
      i++;
      continue;
    }
    if (/^```/.test(t)) {
      const lm = t.match(/^```(\w*)/);
      const lang = (lm && lm[1]) || "";
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        buf.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      out.push(
        <CodeBlock key={`cb${ctx.id++}`} lang={lang} code={buf.join("\n")} delay={delayFor(ctx)} />
      );
      continue;
    }
    if (HR_RE.test(line)) {
      out.push(<hr key={`hr${ctx.id++}`} style={{ animationDelay: delayFor(ctx) }} />);
      i++;
      continue;
    }
    const hm = line.match(/^(#{1,6})\s+(.*)$/);
    if (hm) {
      const lvl = Math.min(3, hm[1].length);
      const Tag = `h${lvl}` as "h1" | "h2" | "h3";
      out.push(
        <Tag key={`h${ctx.id++}`} style={{ animationDelay: delayFor(ctx) }}>
          {renderInline(hm[2].trim())}
        </Tag>
      );
      i++;
      continue;
    }
    if (/^>\s?/.test(t)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push(
        <blockquote key={`q${ctx.id++}`} style={{ animationDelay: delayFor(ctx) }}>
          {renderInline(buf.join(" "))}
        </blockquote>
      );
      continue;
    }
    const li = listInfo(line);
    if (li) {
      const res = parseList(lines, i, li.indent, ctx, delayFor(ctx));
      out.push(res.node);
      i = res.next;
      continue;
    }
    const buf: string[] = [line];
    while (i + 1 < lines.length && lines[i + 1].trim() !== "" && !isBlockStart(lines[i + 1])) {
      i++;
      buf.push(lines[i]);
    }
    out.push(
      <p key={`p${ctx.id++}`} style={{ animationDelay: delayFor(ctx) }}>
        {renderInline(buf.join(" "))}
      </p>
    );
    i++;
  }
  return out;
}

function CodeBlock({
  lang,
  code,
  delay,
  copyText,
}: {
  lang: string;
  code: string;
  delay?: string;
  copyText?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = (event: React.MouseEvent) => {
    event.stopPropagation();
    copyToClipboard(copyText ?? code, () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  };
  return (
    <div className="md-code" style={delay ? { animationDelay: delay } : undefined}>
      <div className="md-code-head">
        <span className="md-code-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="md-code-lang">{lang || "code"}</span>
        <button
          type="button"
          className={`md-code-copy${copied ? " md-copy-ok" : ""}`}
          onClick={copy}
          aria-label="Copy code"
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function renderSegment(raw: string, ctxSeed: number): ReactNode[] {
  return parseBlocks(raw).map((node, idx) => (
    <Fragment key={`seg${ctxSeed}-${idx}`}>{node}</Fragment>
  ));
}

export function MessageBubble({ message }: MessageBubbleProps) {
  if (message.role === "user") {
    return (
      <div className="msg user">
        <div className="msg-body">
          <div className="msg-meta">
            <span>{formatClock(message.timestamp)}</span>
            <span>you</span>
          </div>
          <div className="msg-text">{message.content}</div>
          <div className="msg-actions">
            <CopyButton text={message.content} />
          </div>
        </div>
      </div>
    );
  }

  const [animate] = useState(() => {
    if (prefersReducedMotion()) return false;
    const age = Date.now() - new Date(message.timestamp).getTime();
    return Number.isFinite(age) && age >= 0 && age < FRESH_WINDOW_MS;
  });
  const segments = useMemo(() => segmentContent(message.content), [message.content]);
  const codeMetas = useMemo(() => segments.map((s) => codeMeta(s)), [segments]);
  const parsedFull = useMemo(() => segments.map((s) => parseBlocks(s)), [segments]);
  const revealLens = useMemo(
    () => segments.map((s, i) => (codeMetas[i] ? codeMetas[i]!.body.length : s.length)),
    [segments, codeMetas]
  );
  const totalLen = useMemo(() => revealLens.reduce((a, b) => a + b, 0), [revealLens]);
  const fullBlocks = useMemo(() => parseBlocks(message.content), [message.content]);
  const [shown, setShown] = useState(animate ? 0 : totalLen);
  const [done, setDone] = useState(!animate || totalLen === 0);
  const completeRef = useRef(!animate || totalLen === 0);

  useEffect(() => {
    if (!animate || totalLen === 0) {
      setShown(totalLen);
      setDone(true);
      completeRef.current = true;
      return;
    }
    const step = Math.max(2, Math.round(totalLen / (REVEAL_MS / 16)));
    let value = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      value = Math.min(totalLen, value + step);
      setShown(value);
      if (value >= totalLen) {
        setDone(true);
        completeRef.current = true;
        return;
      }
      timer = setTimeout(tick, 16);
    };
    timer = setTimeout(tick, 70);
    return () => clearTimeout(timer);
  }, [animate, totalLen]);

  const complete = useCallback(() => {
    if (completeRef.current) return;
    completeRef.current = true;
    setShown(totalLen);
    setDone(true);
  }, [totalLen]);

  let body: ReactNode;
  if (done) {
    body = <div className="md">{fullBlocks}</div>;
  } else {
    let cursor = 0;
    let activeIndex = -1;
    let activeOffset = 0;
    for (let i = 0; i < segments.length; i++) {
      const len = revealLens[i];
      if (cursor + len <= shown) {
        cursor += len;
        continue;
      }
      activeIndex = i;
      activeOffset = shown - cursor;
      break;
    }
    const rendered: ReactNode[] = [];
    for (let i = 0; i < activeIndex; i++) {
      const meta = codeMetas[i];
      if (meta) {
        rendered.push(<CodeBlock key={`done-${i}`} lang={meta.lang} code={meta.body} />);
      } else {
        rendered.push(
          <Fragment key={`done-${i}`}>
            {parsedFull[i].map((node, idx) => (
              <Fragment key={`done-${i}-${idx}`}>{node}</Fragment>
            ))}
          </Fragment>
        );
      }
    }
    if (activeIndex >= 0) {
      const meta = codeMetas[activeIndex];
      if (meta) {
        rendered.push(
          <CodeBlock
            key={`active-${activeIndex}`}
            lang={meta.lang}
            code={meta.body.slice(0, activeOffset)}
            copyText={meta.body}
          />
        );
      } else {
        const partialRaw = segments[activeIndex].slice(0, activeOffset);
        rendered.push(
          <Fragment key={`active-${activeIndex}`}>
            {renderSegment(partialRaw, activeIndex)}
          </Fragment>
        );
      }
    }
    body = (
      <div className="md">
        {rendered}
        <span className="typing-cursor" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="msg">
      <div className="msg-avatar">
        <Icon name="spark" size={16} />
      </div>
      <div className="msg-body">
        <div className="msg-meta">
          <span className="ai-name">ContextOS</span>
          <span>{formatClock(message.timestamp)}</span>
        </div>
        <div
          className="msg-text"
          onClick={!done ? complete : undefined}
          style={!done ? { cursor: "pointer" } : undefined}
          title={!done ? "Click to reveal full answer" : undefined}
        >
          {body}
        </div>
        <div className="msg-actions">
          <CopyButton text={message.content} />
        </div>
      </div>
    </div>
  );
}