import type { CSSProperties, ReactNode } from 'react';
import { darken, deadify, lighten } from './color';

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** 0..1 progress of `s` through the window [a, b]. */
export const win = (s: number, a: number, b: number) => clamp01((s - a) / (b - a));
export const cv = (o: Record<string, string | number>) => o as unknown as CSSProperties;

export interface Ctx {
  s: number;
  dead: boolean;
  anim: boolean;
  lite: boolean;
  grads: Map<string, { k: 'r' | 'l' | 'g'; c: string }>;
  col: (c: string) => string;
  rg: (c: string) => string;
  lg: (c: string) => string;
  glow: (c: string) => string;
}

export function makeCtx(id: string, s: number, dead: boolean, anim: boolean, lite: boolean): Ctx {
  const grads: Ctx['grads'] = new Map();
  const col = (c: string) => (dead ? deadify(c) : c);
  const reg = (k: 'r' | 'l' | 'g', c: string) => {
    const cc = col(c);
    const gid = `${id}-${k}${cc.slice(1)}`;
    grads.set(gid, { k, c: cc });
    return `url(#${gid})`;
  };
  return { s, dead, anim, lite, grads, col, rg: c => reg('r', c), lg: c => reg('l', c), glow: c => reg('g', c) };
}

/** Must render after the plant body so every gradient has been registered. */
export function Defs({ ctx }: { ctx: Ctx }) {
  return (
    <defs>
      {[...ctx.grads].map(([gid, { k, c }]) =>
        k === 'g' ? (
          <radialGradient key={gid} id={gid}>
            <stop offset="0" stopColor={c} stopOpacity="0.85" />
            <stop offset="0.55" stopColor={c} stopOpacity="0.25" />
            <stop offset="1" stopColor={c} stopOpacity="0" />
          </radialGradient>
        ) : k === 'r' ? (
          <radialGradient key={gid} id={gid} cx="0.35" cy="0.3" r="0.85">
            <stop offset="0" stopColor={lighten(c, 0.35)} />
            <stop offset="0.5" stopColor={c} />
            <stop offset="1" stopColor={darken(c, 0.3)} />
          </radialGradient>
        ) : (
          <linearGradient key={gid} id={gid} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor={darken(c, 0.15)} />
            <stop offset="0.4" stopColor={lighten(c, 0.18)} />
            <stop offset="1" stopColor={darken(c, 0.32)} />
          </linearGradient>
        ),
      )}
    </defs>
  );
}

/** Subtle outline props derived from a base colour. */
export const ol = (ctx: Ctx, c: string, w = 0.9) => ({
  stroke: ctx.col(darken(c, 0.45)),
  strokeOpacity: 0.45,
  strokeWidth: w,
});

interface GrowProps {
  ctx: Ctx;
  a: number;
  b: number;
  ox: number;
  oy: number;
  min?: number;
  axis?: 'xy' | 'y';
  sink?: number;
  droop?: number;
  children: ReactNode;
}

/** Scales its children out of (ox, oy) as stage moves through [a, b]; springs via CSS transition. */
export function Grow({ ctx, a, b, ox, oy, min = 0, axis = 'xy', sink = 0, droop = 0, children }: GrowProps) {
  const v = win(ctx.s, a, b);
  const k = Math.max(0.001, (min + (1 - min) * v) * (ctx.dead ? 0.94 : 1));
  const kx = axis === 'y' ? 1 : k;
  const transform = `translate(0px,${ctx.dead ? sink : 0}px) rotate(${ctx.dead ? droop : 0}deg) scale(${kx},${k})`;
  return (
    <g className="pl-grow" style={{ transform, transformOrigin: `${ox}px ${oy}px`, opacity: v > 0.001 || min > 0 ? 1 : 0 }}>
      {children}
    </g>
  );
}

interface SwayProps {
  ctx: Ctx;
  ox: number;
  oy: number;
  a?: number;
  t?: number;
  d?: number;
  force?: boolean;
  children: ReactNode;
}

/** Wind sway around (ox, oy). Nested sways are skipped in lite mode unless `force`. */
export function Sway({ ctx, ox, oy, a = 2, t = 5, d = 0, force, children }: SwayProps) {
  const on = ctx.anim && !ctx.dead && (force || !ctx.lite);
  return (
    <g
      className={on ? 'pl-sway' : undefined}
      style={cv({ transformOrigin: `${ox}px ${oy}px`, '--a': `${a}deg`, '--t': `${t}s`, '--d': `${d}s` })}
    >
      {children}
    </g>
  );
}

interface StemProps {
  ctx: Ctx;
  d: string;
  w: number;
  c: string;
  a: number;
  b: number;
}

/** A path that draws itself along its length as stage advances. */
export function Stem({ ctx, d, w, c, a, b }: StemProps) {
  const v = win(ctx.s, a, b);
  const style: CSSProperties = {
    strokeDasharray: '1 1',
    strokeDashoffset: 1 - v,
    opacity: v > 0.001 ? 1 : 0,
  };
  const base = ctx.col(c);
  const common = { d, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, pathLength: 1, className: 'pl-draw', style };
  return (
    <g>
      <path {...common} stroke={darken(base, 0.4)} strokeOpacity={0.5} strokeWidth={w + 1.6} />
      <path {...common} stroke={base} strokeWidth={w} />
      <path {...common} stroke={lighten(base, 0.35)} strokeOpacity={0.55} strokeWidth={Math.max(0.8, w * 0.28)} transform={`translate(${-w * 0.2} 0)`} />
    </g>
  );
}

interface LeafProps {
  ctx: Ctx;
  x: number;
  y: number;
  len: number;
  rot: number;
  c: string;
  a: number;
  b: number;
  w?: number;
  sway?: number;
  d?: number;
}

export function Leaf({ ctx, x, y, len, rot, c, a, b, w = 0.4, sway = 3, d = 0 }: LeafProps) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      <Sway ctx={ctx} ox={0} oy={0} a={sway} t={4} d={d}>
        <Grow ctx={ctx} a={a} b={b} ox={0} oy={0} droop={rot > 90 && rot < 270 ? -28 : 28}>
          <path
            d={`M0 0 Q${len * 0.35} ${-len * w} ${len} 0 Q${len * 0.35} ${len * w} 0 0Z`}
            fill={ctx.rg(c)}
            {...ol(ctx, c, 0.7)}
          />
          <path d={`M1.5 0 L${len * 0.85} 0`} stroke={lighten(ctx.col(c), 0.4)} strokeWidth={0.8} strokeOpacity={0.6} strokeLinecap="round" />
        </Grow>
      </Sway>
    </g>
  );
}

interface BlobProps {
  ctx: Ctx;
  x: number;
  y: number;
  r: number;
  c: string;
  a: number;
  b: number;
  sy?: number;
}

/** Soft, layered foliage blob that grows from its own centre. */
export function Blob({ ctx, x, y, r, c, a, b, sy = 1 }: BlobProps) {
  return (
    <Grow ctx={ctx} a={a} b={b} ox={x} oy={y} sink={r * 0.35}>
      <ellipse cx={x} cy={y} rx={r} ry={r * sy} fill={ctx.rg(c)} {...ol(ctx, c)} />
      <ellipse cx={x - r * 0.1} cy={y - r * 0.18 * sy} rx={r * 0.68} ry={r * 0.62 * sy} fill={ctx.rg(lighten(c, 0.14))} opacity={0.7} />
      <ellipse cx={x - r * 0.32} cy={y - r * 0.4 * sy} rx={r * 0.42} ry={r * 0.24 * sy} fill="#fff" opacity={0.22} />
    </Grow>
  );
}

interface CanopyProps {
  ctx: Ctx;
  blobs: readonly (readonly [number, number, number])[];
  c: string;
  a: number;
  b: number;
  colors?: readonly string[];
  sy?: number;
}

/** Back-to-front blobs that unfurl one after another. */
export function Canopy({ ctx, blobs, c, a, b, colors, sy = 1 }: CanopyProps) {
  const n = blobs.length;
  const span = (b - a) * 0.55;
  const step = (b - a - span) / Math.max(1, n - 1);
  return (
    <>
      {blobs.map(([x, y, r], i) => (
        <Blob key={i} ctx={ctx} x={x} y={y} r={r} sy={sy} c={colors ? colors[i % colors.length] : c} a={a + i * step} b={a + i * step + span} />
      ))}
    </>
  );
}

export const star4 = (r: number) =>
  `M0 ${-r} Q${r * 0.15} ${-r * 0.15} ${r} 0 Q${r * 0.15} ${r * 0.15} 0 ${r} Q${-r * 0.15} ${r * 0.15} ${-r} 0 Q${-r * 0.15} ${-r * 0.15} 0 ${-r}Z`;

export const PETAL = 'M0 0 C-4 -3 -4 -8 0 -10 C4 -8 4 -3 0 0Z';
export const MAPLE_LEAF = 'M0 -9 L2 -5 L6 -7 L5 -2 L9 -1 L5 2 L6 5 L1 4 L0 9 L-1 4 L-6 5 L-5 2 L-9 -1 L-5 -2 L-6 -7 L-2 -5Z';
export const DRY_LEAF = 'M0 -7 C4 -4 4 3 0 7 C-4 3 -4 -4 0 -7Z';

interface FallerProps {
  ctx: Ctx;
  items: readonly (readonly [number, number])[];
  shape: string;
  colors: readonly string[];
  scale?: number;
  dy?: number;
  /** Stage from which the particles appear. */
  from?: number;
}

/** Slowly falling petals/leaves; item = [x, y] start. Delays are derived from the index. */
export function Fallers({ ctx, items, shape, colors, scale = 1, dy = 90, from = 0.7 }: FallerProps) {
  if (!ctx.anim || ctx.lite || ctx.s < from) return null;
  return (
    <>
      {items.map(([x, y], i) => (
        <g key={i} transform={`translate(${x} ${y}) scale(${scale})`}>
          <g
            className="pl-fall"
            style={cv({
              '--dx': `${(i % 2 ? 1 : -1) * (14 + (i % 3) * 7)}px`,
              '--dy': `${dy + (i % 3) * 8}px`,
              '--t': `${6 + (i % 4)}s`,
              '--d': `${-i * 1.7}s`,
              '--r': `${(i % 2 ? 1 : -1) * 260}deg`,
            })}
          >
            <path d={shape} fill={ctx.col(colors[i % colors.length])} />
          </g>
        </g>
      ))}
    </>
  );
}

interface TwinkleProps {
  ctx: Ctx;
  x: number;
  y: number;
  r: number;
  c: string;
  d?: number;
  t?: number;
}

export function Twinkle({ ctx, x, y, r, c, d = 0, t = 2.6 }: TwinkleProps) {
  const on = ctx.anim && !ctx.dead && !ctx.lite;
  return (
    <g transform={`translate(${x} ${y})`}>
      <path
        className={on ? 'pl-twinkle' : undefined}
        d={star4(r)}
        fill={ctx.col(c)}
        style={cv({ '--d': `${d}s`, '--t': `${t}s`, transformOrigin: '0 0', ...(on ? {} : { opacity: 0.85 }) })}
      />
    </g>
  );
}

interface FlyerProps {
  ctx: Ctx;
  x: number;
  y: number;
  c: string;
  show: boolean;
  d?: number;
}

export function Butterfly({ ctx, x, y, c, show, d = 0 }: FlyerProps) {
  if (!ctx.anim || ctx.lite || ctx.dead) return null;
  return (
    <g transform={`translate(${x} ${y})`} style={{ opacity: show ? 1 : 0, transition: 'opacity 1s' }}>
      <g className="pl-flutter" style={cv({ '--d': `${d}s` })}>
        <g className="pl-flap" style={{ transformOrigin: '0 0' }}>
          <path d="M0 0 C-3 -7 -10 -8 -9 -2 C-8 2 -3 2 0 0Z M0 0 C3 -7 10 -8 9 -2 C8 2 3 2 0 0Z" fill={c} />
          <path d="M0 0 C-2 3 -6 6 -4 3Z M0 0 C2 3 6 6 4 3Z" fill={darken(c, 0.2)} />
        </g>
        <rect x={-0.6} y={-3} width={1.2} height={6} rx={0.6} fill="#3b2a20" />
      </g>
    </g>
  );
}

export function Bee({ ctx, x, y, show, d = 0 }: Omit<FlyerProps, 'c'>) {
  if (!ctx.anim || ctx.lite || ctx.dead) return null;
  return (
    <g transform={`translate(${x} ${y})`} style={{ opacity: show ? 1 : 0, transition: 'opacity 1s' }}>
      <g className="pl-bee" style={cv({ '--d': `${d}s` })}>
        <ellipse cx={-2} cy={-3.5} rx={3} ry={1.6} fill="#e0f2fe" opacity={0.8} className="pl-flap" style={{ transformOrigin: '-1px -2px' }} />
        <ellipse cx={0} cy={0} rx={4} ry={2.8} fill="#fbbf24" />
        <path d="M-1 -2.6 V2.6 M1.6 -2.5 V2.5" stroke="#3b2a20" strokeWidth={1.1} />
        <circle cx={4} cy={0} r={1.4} fill="#3b2a20" />
      </g>
    </g>
  );
}
