import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import './styles';
import { Plant, TreeComponent } from './Plant';
import { cv } from './kit';
import { speciesName } from './species';

export type SceneState = 'idle' | 'running' | 'paused' | 'completed' | 'withered';

const hash = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

const SKY = {
  calm: 'bg-gradient-to-b from-sky-400 via-sky-200 to-amber-50 dark:from-slate-950 dark:via-indigo-950 dark:to-slate-800',
  gold: 'bg-gradient-to-b from-amber-300 via-orange-200 to-yellow-50 dark:from-indigo-950 dark:via-fuchsia-900 dark:to-amber-700',
  grey: 'bg-gradient-to-b from-slate-500 via-slate-300 to-stone-200 dark:from-slate-950 dark:via-slate-800 dark:to-stone-700',
};

const CLOUDS: { top: string; w: string; t: number; d: number }[] = [
  { top: '10%', w: '22%', t: 90, d: -10 },
  { top: '24%', w: '28%', t: 120, d: -62 },
  { top: '6%', w: '16%', t: 150, d: -100 },
];

function Cloud({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 64 28" className={cn('h-auto w-full', className)} aria-hidden="true">
      <g fill="currentColor">
        <circle cx={18} cy={18} r={9} />
        <circle cx={32} cy={12} r={12} />
        <circle cx={46} cy={18} r={9} />
        <rect x={10} y={18} width={44} height={9} rx={4.5} />
      </g>
    </svg>
  );
}

const STARS = [[8, 14], [22, 30], [34, 8], [48, 20], [60, 10], [72, 26], [86, 16], [94, 34]];

function Blade({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 24 20" className={cn('absolute pl-sway', className)} style={style} aria-hidden="true">
      <g fill="currentColor">
        <path d="M12 20 Q10 10 4 2 Q13 8 14 20Z" />
        <path d="M11 20 Q12 8 12 0 Q16 9 15 20Z" />
        <path d="M13 20 Q16 11 22 5 Q18 14 17 20Z" />
      </g>
    </svg>
  );
}

const GRASS = [[5, 3], [15, 9], [27, 2], [73, 8], [84, 2], [93, 7]];

/** Sky, sun/moon, clouds, hills. Everything fades between states with opacity transitions. */
function Backdrop({ state, rich, hillsClass, h }: { state: SceneState; rich: boolean; hillsClass: string; h: number }) {
  const calm = state !== 'completed' && state !== 'withered';
  const withered = state === 'withered';
  const cloudColor = withered
    ? 'text-slate-400/90 dark:text-slate-500/40'
    : state === 'completed'
      ? 'text-amber-50/90 dark:text-fuchsia-200/25'
      : 'text-white/90 dark:text-slate-400/15';
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className={cn('pl-fade absolute inset-0', SKY.calm)} style={{ opacity: calm ? 1 : 0 }} />
      <div className={cn('pl-fade absolute inset-0', SKY.gold)} style={{ opacity: state === 'completed' ? 1 : 0 }} />
      <div className={cn('pl-fade absolute inset-0', SKY.grey)} style={{ opacity: withered ? 1 : 0 }} />

      <div className="pl-fade hidden dark:block" style={{ opacity: calm ? 1 : 0.2 }}>
        {STARS.map(([x, y], i) => (
          <span
            key={i}
            className={cn('absolute h-[2px] w-[2px] rounded-full bg-white', i % 2 && 'pl-twinkle')}
            style={cv({ left: `${x}%`, top: `${y * 0.7}%`, '--d': `${-i * 0.7}s`, '--t': `${3 + (i % 3)}s` })}
          />
        ))}
      </div>

      <div
        className="pl-grow absolute right-[9%] top-[9%] h-11 w-11"
        style={{ opacity: withered ? 0.2 : 1, transform: `scale(${state === 'completed' ? 1.18 : 1})` }}
      >
        <svg viewBox="-50 -50 100 100" className="pl-spin absolute -inset-5 h-auto w-[calc(100%+2.5rem)] text-amber-300 dark:hidden" style={cv({ '--t': '70s' })}>
          {Array.from({ length: 12 }, (_, i) => (
            <line key={i} x1={0} y1={-34} x2={0} y2={i % 2 ? -41 : -47} stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" transform={`rotate(${i * 30})`} />
          ))}
        </svg>
        <div className="absolute inset-0 rounded-full bg-amber-300 shadow-[0_0_30px_10px_rgba(251,191,36,.55)] dark:bg-slate-100 dark:shadow-[0_0_24px_6px_rgba(226,232,240,.3)]" />
      </div>

      {CLOUDS.slice(0, rich ? 3 : 2).map((cl, i) => (
        <div key={i} className="pl-drift absolute inset-x-0" style={cv({ top: cl.top, '--t': `${cl.t}s`, '--d': `${cl.d}s` })}>
          <div style={{ width: cl.w, maxWidth: 190 }}>
            <Cloud className={cn('pl-fade', cloudColor)} />
          </div>
        </div>
      ))}

      {rich && !withered &&
        [{ top: '22%', t: 30, d: -6 }, { top: '34%', t: 42, d: -26 }].map((b, i) => (
          <div key={i} className="pl-drift absolute inset-x-0" style={cv({ top: b.top, '--t': `${b.t}s`, '--d': `${b.d}s` })}>
            <svg viewBox="0 0 16 8" className="pl-bird h-2 w-4 text-slate-700/70 dark:text-slate-300/50" style={{ transformOrigin: '50% 100%' }}>
              <path d="M0 4 Q4 0 8 4 Q12 0 16 4" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
            </svg>
          </div>
        ))}

      {withered &&
        Array.from({ length: 10 }, (_, i) => (
          <span
            key={i}
            className="pl-rain absolute top-0 h-4 w-px rotate-[12deg] bg-slate-500/60 dark:bg-slate-300/40"
            style={cv({ left: `${6 + i * 9.5}%`, '--h': `${h}px`, '--d': `${-(i * 0.37) % 1.4}s`, '--t': `${1.1 + (i % 3) * 0.2}s` })}
          />
        ))}

      <div className={cn('pl-fade absolute inset-x-0 bottom-0', hillsClass)} style={{ filter: withered ? 'grayscale(.85) brightness(.92)' : 'none', transition: 'filter 1.2s' }}>
        <svg viewBox="0 0 400 100" preserveAspectRatio="none" className="h-full w-full">
          <path d="M0 52 C60 18 120 30 190 48 S330 28 400 42 V100 H0Z" className="fill-emerald-300 dark:fill-emerald-900" />
          <path d="M0 66 C90 40 150 62 230 52 S350 44 400 58 V100 H0Z" className="fill-emerald-400 dark:fill-emerald-800" />
          <path d="M0 80 C80 62 160 74 240 68 S360 62 400 72 V100 H0Z" className="fill-green-500 dark:fill-green-800" />
        </svg>
        {rich &&
          GRASS.map(([x, b], i) => (
            <Blade
              key={i}
              className="h-4 w-5 text-green-400 dark:text-green-700"
              style={cv({ left: `${x}%`, bottom: `${b}%`, transformOrigin: '50% 100%', '--a': '7deg', '--t': `${3 + (i % 3)}s`, '--d': `${-i * 0.5}s` })}
            />
          ))}
      </div>
    </div>
  );
}

const CONFETTI = ['#f43f5e', '#fbbf24', '#38bdf8', '#34d399', '#a78bfa', '#fb923c'];
const STATE_LABEL: Record<SceneState, string> = {
  idle: 'ready to plant', running: 'growing', paused: 'paused', completed: 'fully grown', withered: 'withered',
};

export function PlantScene({ state, progress, species, height = 260, className, children }: {
  state: SceneState;
  progress: number;
  species: string;
  height?: number;
  className?: string;
  children?: ReactNode;
}) {
  const gid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  const stage = state === 'completed' ? 1 : progress;
  const plantSize = Math.round(height * 0.9);
  const label = `${speciesName(species)}, ${STATE_LABEL[state]}${state === 'completed' ? '' : `, ${pct}% grown`}`;

  return (
    <div
      role="img"
      aria-label={label}
      className={cn('relative isolate w-full overflow-hidden rounded-2xl', state === 'paused' && 'pl-paused', className)}
      style={{ height }}
    >
      <Backdrop state={state} rich hillsClass="h-[42%]" h={height} />

      {state === 'completed' && (
        <div className="pointer-events-none absolute left-1/2 top-[46%] -translate-x-1/2 -translate-y-1/2 animate-in fade-in zoom-in-50 duration-1000 motion-reduce:animate-none" style={{ width: height * 2.4, height: height * 2.4 }} aria-hidden="true">
          <div
            className="pl-spin h-full w-full"
            style={cv({
              '--t': '90s',
              background: 'repeating-conic-gradient(from 0deg, rgba(255,236,160,.55) 0deg 7deg, rgba(255,236,160,0) 7deg 18deg)',
              WebkitMaskImage: 'radial-gradient(circle, #000 12%, transparent 62%)',
              maskImage: 'radial-gradient(circle, #000 12%, transparent 62%)',
            })}
          />
        </div>
      )}

      <svg viewBox="0 0 200 56" className="pointer-events-none absolute left-1/2 -translate-x-1/2" style={{ width: height * 0.78, bottom: height * 0.02 }} aria-hidden="true">
        <defs>
          <linearGradient id={`${gid}-soil`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#a8754a" />
            <stop offset="0.5" stopColor="#7a4e2c" />
            <stop offset="1" stopColor="#4a2f1a" />
          </linearGradient>
        </defs>
        <path d="M4 56 C10 24 52 8 100 8 C148 8 190 24 196 56Z" fill={`url(#${gid}-soil)`} />
        <path d="M34 28 C52 15 84 10 112 10 C84 13 58 19 34 28Z" fill="#fff" opacity={0.18} />
        {[[40, 40, 3], [150, 36, 2.4], [126, 46, 2], [70, 48, 2.2]].map(([x, y, r], i) => <ellipse key={i} cx={x} cy={y} rx={r * 1.3} ry={r} fill="#3b2412" opacity={0.45} />)}
        {[[24, 44], [172, 42]].map(([x, y], i) => (
          <path key={i} d={`M${x} ${y} q-1 -9 -5 -12 M${x} ${y} q1 -10 3 -14 M${x} ${y} q3 -7 7 -9`} fill="none" stroke="#5fbf6a" strokeWidth={2} strokeLinecap="round" />
        ))}
      </svg>

      <div className="pointer-events-none absolute left-1/2 -translate-x-1/2" style={{ bottom: height * 0.1, width: plantSize, height: plantSize }}>
        <Plant species={species} stage={stage} dead={state === 'withered'} celebrate={state === 'completed'} size={plantSize} ground="shadow" />
      </div>

      {state === 'running' && (
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => (
            <span
              key={i}
              className={cn('pl-rise absolute h-1.5 w-1.5 rounded-full', i % 3 === 2 ? 'bg-emerald-200 shadow-[0_0_6px_2px_rgba(110,231,183,.7)]' : 'bg-amber-200 shadow-[0_0_6px_2px_rgba(253,224,71,.7)]')}
              style={cv({
                left: `${40 + ((i * 37) % 22)}%`,
                bottom: height * 0.26,
                '--h': `${height}px`,
                '--dx': `${(i % 2 ? 1 : -1) * (8 + (i % 4) * 6)}px`,
                '--t': `${5 + (i % 4)}s`,
                '--d': `${-i * 0.9}s`,
              })}
            />
          ))}
          <div className="absolute" style={{ left: 'calc(50% + 34px)', bottom: height * 0.2 }}>
            <svg viewBox="0 0 10 14" className="pl-drop h-3 w-2 text-sky-400"><path d="M5 0 C5 5 0 8 0 10 A5 5 0 0 0 10 10 C10 8 5 5 5 0Z" fill="currentColor" /></svg>
            <span className="pl-splash absolute -bottom-1 -left-1.5 h-1.5 w-5 rounded-full border border-sky-200/90" />
          </div>
        </div>
      )}

      {state === 'completed' && (
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          {Array.from({ length: 12 }, (_, i) => (
            <span
              key={i}
              className="pl-confetti absolute top-0 h-1.5 w-2.5 rounded-[1px]"
              style={cv({
                left: `${4 + i * 8}%`,
                background: CONFETTI[i % CONFETTI.length],
                '--h': `${height}px`,
                '--dx': `${(i % 2 ? 1 : -1) * (12 + (i % 3) * 8)}px`,
                '--t': `${5 + (i % 4)}s`,
                '--d': `${-i * 0.8}s`,
              })}
            />
          ))}
        </div>
      )}

      <div className="pl-fade pointer-events-none absolute inset-0 bg-slate-950/25" style={{ opacity: state === 'paused' ? 1 : 0 }} aria-hidden="true" />

      {children && (
        <>
          <div
            className="pointer-events-none absolute inset-0 z-10 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,.4),transparent_62%)] dark:bg-[radial-gradient(ellipse_at_center,rgba(2,6,23,.55),transparent_62%)]"
            aria-hidden="true"
          />
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center">{children}</div>
        </>
      )}
    </div>
  );
}

function MeadowPlant({ plant, index, base, lite }: { plant: { id: string; species: string; label?: string; dead?: boolean }; index: number; base: number; lite: boolean }) {
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGrown(true), 120 + Math.min(index * 70, 1600));
    return () => clearTimeout(t);
  }, [index]);

  const h = hash(plant.id + plant.species);
  const depth = h % 3;
  const size = Math.round(base * [0.84, 1, 1.16][depth]);
  const name = plant.label ?? speciesName(plant.species);
  const text = plant.dead ? `${name} (withered)` : name;
  return (
    <div
      className="group relative shrink-0 outline-none hover:!z-40 focus-visible:!z-40"
      tabIndex={0}
      aria-label={text}
      style={{
        width: size,
        height: size,
        zIndex: depth,
        marginInline: -size * 0.07,
        marginTop: -size * 0.22,
        transform: `translateY(${(2 - depth) * 4}px)`,
        opacity: grown ? 1 : 0,
        transition: 'opacity .5s ease',
      }}
    >
      <div className="pl-hoverwig h-full w-full">
        <Plant species={plant.species} stage={grown ? 1 : 0} dead={plant.dead} size={size} lite={lite} pops={false} />
      </div>
      <span className="pointer-events-none absolute left-1/2 top-[8%] z-30 -translate-x-1/2 whitespace-nowrap rounded-full bg-slate-900/90 px-2 py-0.5 text-[10px] font-medium text-white opacity-0 shadow transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-slate-100/95 dark:text-slate-900">
        {text}
      </span>
    </div>
  );
}

export function Meadow({ plants, className, emptyHint }: {
  plants: { id: string; species: string; label?: string; dead?: boolean }[];
  className?: string;
  emptyHint?: string;
}) {
  const n = plants.length;
  const base = n <= 5 ? 150 : n <= 12 ? 120 : n <= 24 ? 96 : 76;
  return (
    <div className={cn('relative isolate min-h-[200px] w-full overflow-hidden rounded-2xl', className)} role="group" aria-label={`Your garden: ${n} plant${n === 1 ? '' : 's'}`}>
      <Backdrop state="idle" rich={false} hillsClass="h-[38%] min-h-[88px]" h={200} />
      {n === 0 ? (
        <div className="relative z-10 flex min-h-[200px] flex-col items-center justify-between px-4 pb-3 pt-6 text-center">
          <p className="max-w-[18rem] rounded-full bg-white/70 px-3 py-1 text-xs font-medium text-slate-800 backdrop-blur-sm dark:bg-slate-900/60 dark:text-slate-100">
            {emptyHint ?? 'Your garden is waiting for its first plant.'}
          </p>
          <TreeComponent species="bush" stage={0.2} size={150} />
        </div>
      ) : (
        <div className="relative z-10 flex max-h-[26rem] flex-wrap items-end justify-center overflow-y-auto px-4 pb-4 pt-12">
          {plants.map((p, i) => (
            <MeadowPlant key={p.id} plant={p} index={i} base={base} lite={n > 14} />
          ))}
        </div>
      )}
    </div>
  );
}
