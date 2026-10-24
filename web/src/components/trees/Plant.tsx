import { useEffect, useId, useRef } from 'react';
import './styles';
import { Defs, DRY_LEAF, Fallers, Leaf, PETAL, Stem, Sway, Twinkle, clamp01, cv, makeCtx, star4, type Ctx } from './kit';
import { RENDERERS } from './renderers';

export interface PlantProps {
  species: string;
  /** 0..1 continuous growth. */
  stage: number;
  dead?: boolean;
  size?: number;
  /** Wind sway + idle life. Default true. */
  animate?: boolean;
  /** Burst of sparkles and keep twinkling. */
  celebrate?: boolean;
  /** 'full' = soil mound + tuft + shadow, 'shadow' = contact shadow only, 'none'. */
  ground?: 'full' | 'shadow' | 'none';
  /** Cheaper variant for crowds: a single sway, no particles. */
  lite?: boolean;
  /** Pop + sparkles when crossing 0.25/0.5/0.75/1. */
  pops?: boolean;
  className?: string;
}

const B = 180;
const THRESHOLDS = [0.25, 0.5, 0.75, 1];
const BURST_COLORS = ['#fde047', '#f9a8d4', '#ffffff', '#86efac', '#fbbf24', '#93c5fd'];

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function Sprout({ c, y }: { c: Ctx; y: number }) {
  const fade = 1 - clamp01((c.s - 0.24) / 0.16);
  return (
    <g className="pl-fade" style={{ opacity: fade }}>
      <g style={{ opacity: 1 - clamp01((c.s - 0.05) / 0.07), transition: 'opacity .6s' }}>
        <ellipse cx={100} cy={y - 3} rx={6} ry={3.6} fill={c.rg('#d8b27a')} stroke={c.col('#7a5230')} strokeWidth={0.8} />
        <path d={`M95 ${y - 3} Q100 ${y - 5} 105 ${y - 3}`} fill="none" stroke="#fff" strokeOpacity={0.5} strokeWidth={0.8} />
      </g>
      <Stem ctx={c} d={`M100 ${y} Q98 ${y - 11} 101 ${y - 21}`} w={3} c="#4aa85a" a={0.01} b={0.1} />
      <Leaf ctx={c} x={101} y={y - 21} len={21} rot={-35} c="#6fcf7a" a={0.06} b={0.16} w={0.45} />
      <Leaf ctx={c} x={101} y={y - 21} len={21} rot={-145} c="#5cc06b" a={0.08} b={0.18} w={0.45} d={-1.5} />
    </g>
  );
}

function Ground({ c, mode }: { c: Ctx; mode: 'full' | 'shadow' }) {
  const blades = [[62, 1], [68, -1], [74, 1], [126, -1], [132, 1], [139, -1]] as const;
  return (
    <g>
      <ellipse cx={100} cy={B + 2} rx={52} ry={8} fill="#1c1410" opacity={c.dead ? 0.14 : 0.2} />
      {mode === 'full' && (
        <>
          <ellipse cx={100} cy={B + 1} rx={44} ry={9} fill={c.rg('#8b5a2b')} />
          <ellipse cx={92} cy={B - 2} rx={22} ry={3} fill="#fff" opacity={0.12} />
          {blades.map(([x, dir], i) => (
            <g key={i} transform={`translate(${x} ${B + 3})`}>
              <g
                className={c.anim && !c.dead && !c.lite ? 'pl-sway' : undefined}
                style={cv({ transformOrigin: '0px 0px', '--a': '6deg', '--t': `${3 + (i % 3)}s`, '--d': `${-i * 0.6}s` })}
              >
                <path d={`M-2 0 Q${dir * 1} -9 ${dir * 5} ${-14 - (i % 2) * 4} Q${dir * 3} -6 2 0Z`} fill={c.col(i % 2 ? '#4aa85a' : '#62c070')} />
              </g>
            </g>
          ))}
        </>
      )}
    </g>
  );
}

export function Plant({
  species, stage, dead = false, size = 120, animate = true, celebrate = false, ground = 'full', lite = false, pops = true, className,
}: PlantProps) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const s = clamp01(Number.isFinite(stage) ? stage : 0);
  const def = RENDERERS[species] ?? RENDERERS.cedar;
  const baseY = def.baseY ?? B;
  const c = makeCtx(id, s, dead, animate, lite);
  const alive = animate && !dead;

  const popRef = useRef<SVGGElement>(null);
  const burstRef = useRef<SVGGElement>(null);
  const prev = useRef(s);
  const wasCelebrating = useRef(false);

  const fire = () => {
    if (reducedMotion()) return;
    popRef.current?.animate(
      [{ transform: 'scale(1,1)' }, { transform: 'scale(1.06,.95)', offset: 0.3 }, { transform: 'scale(.98,1.03)', offset: 0.6 }, { transform: 'scale(1,1)' }],
      { duration: 650, easing: 'ease-out' },
    );
    burstRef.current?.childNodes.forEach((n, i) => {
      const ang = (i / BURST_COLORS.length) * Math.PI * 2 + 0.4;
      const r = 46 + (i % 3) * 14;
      (n as SVGGElement).animate(
        [
          { opacity: 1, transform: 'translate(0px,0px) scale(.3) rotate(0deg)' },
          { opacity: 1, offset: 0.55 },
          { opacity: 0, transform: `translate(${Math.cos(ang) * r}px,${Math.sin(ang) * r - 8}px) scale(1.2) rotate(120deg)` },
        ],
        { duration: 900 + (i % 3) * 150, easing: 'cubic-bezier(.2,.7,.3,1)' },
      );
    });
  };

  useEffect(() => {
    const p = prev.current;
    prev.current = s;
    if (!pops || !alive) return;
    if (THRESHOLDS.some(t => p < t && s >= t)) fire();
  }, [s, pops, alive]);

  useEffect(() => {
    if (celebrate && !wasCelebrating.current && !dead) fire();
    wasCelebrating.current = celebrate;
  }, [celebrate, dead]);

  const burstY = baseY - 72;
  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ overflow: 'visible', display: 'block' }}
    >
      {ground !== 'none' && <Ground c={c} mode={ground} />}
      <g ref={popRef} style={{ transformOrigin: `100px ${B}px` }}>
        <g className="pl-grow" style={{ transformOrigin: `100px ${B}px`, transform: dead ? 'rotate(4deg) scale(1,.95)' : 'rotate(0deg) scale(1,1)' }}>
          <Sway ctx={c} ox={100} oy={B} a={def.sway ?? 1.2} t={6} force>
            <Sprout c={c} y={baseY} />
            {def.render(c)}
          </Sway>
        </g>
      </g>
      {dead && (
        <Fallers ctx={c} items={[[78, B - 90], [120, B - 80], [100, B - 56], [66, B - 40], [134, B - 50]]} shape={DRY_LEAF} colors={['#8a6a45', '#a08a62', '#6f5a3c']} scale={0.8} dy={B - 100} from={0} />
      )}
      {celebrate && alive && (
        <g>
          {[[56, burstY - 6, '#fde047'], [148, burstY, '#f9a8d4'], [100, burstY - 52, '#ffffff'], [74, burstY + 34, '#fbbf24'], [132, burstY + 30, '#fde047']].map(([x, y, col], i) => (
            <Twinkle key={i} ctx={{ ...c, lite: false }} x={x as number} y={y as number} r={4 + (i % 2)} c={col as string} d={-i * 0.5} t={1.8 + i * 0.2} />
          ))}
          <Fallers ctx={c} items={[[70, burstY - 30], [126, burstY - 34], [100, burstY - 44]]} shape={PETAL} colors={['#fde047', '#f9a8d4', '#ffffff']} scale={0.9} dy={110} />
        </g>
      )}
      <g ref={burstRef} aria-hidden="true">
        {BURST_COLORS.map((col, i) => (
          <g key={i} style={{ opacity: 0, transformOrigin: `100px ${burstY}px` }}>
            <path d={star4(5 + (i % 2) * 2)} transform={`translate(100 ${burstY})`} fill={col} />
          </g>
        ))}
      </g>
      <Defs ctx={c} />
    </svg>
  );
}

export function TreeComponent({ species, stage, dead, size = 120, animate = true, celebrate }: {
  species: string; stage: number; dead?: boolean; size?: number; animate?: boolean; celebrate?: boolean;
}) {
  return <Plant species={species} stage={stage} dead={dead} size={size} animate={animate} celebrate={celebrate} />;
}
