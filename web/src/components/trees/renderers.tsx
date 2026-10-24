import type { ReactNode } from 'react';
import { darken, lighten } from './color';
import {
  Bee, Blob, Butterfly, Canopy, Ctx, Fallers, Grow, Leaf, MAPLE_LEAF, PETAL, Stem, Sway, Twinkle, cv, ol, star4,
} from './kit';

type Render = (c: Ctx) => ReactNode;

const BARK = '#8b5e3c';
const B = 180; // ground line in the 200x200 viewBox

const Aura = ({ c, x, y, r, color, a = 0.5, b = 0.9 }: { c: Ctx; x: number; y: number; r: number; color: string; a?: number; b?: number }) => c.dead ? null : (
  <Grow ctx={c} a={a} b={b} ox={x} oy={y}>
    <g className={c.anim && !c.lite && !c.dead ? 'pl-breathe' : undefined} style={{ transformOrigin: `${x}px ${y}px` }}>
      <circle cx={x} cy={y} r={r} fill={c.glow(color)} />
    </g>
  </Grow>
);

const trunk = (c: Ctx, d: string, color: string, a: number, b: number) => (
  <Grow ctx={c} a={a} b={b} ox={100} oy={B} axis="y">
    <path d={d} fill={c.lg(color)} {...ol(c, color)} />
  </Grow>
);

/* ---------- classics ---------- */

const cedar: Render = c => {
  const tiers = [[158, 46, 44], [134, 39, 41], [111, 32, 39], [89, 25, 37], [68, 17, 35]];
  return (
    <>
      {trunk(c, 'M95 181 L96.5 150 L103.5 150 L105 181Z', '#7a5234', 0.04, 0.28)}
      {tiers.map(([y, w, h], i) => (
        <Sway key={i} ctx={c} ox={100} oy={y} a={0.8 + i * 0.3} t={4 + i * 0.5} d={-i * 0.7}>
          <Grow ctx={c} a={0.14 + i * 0.14} b={0.4 + i * 0.14} ox={100} oy={y} sink={4}>
            <path
              d={`M${100 - w} ${y} Q${100 - w * 0.45} ${y - h * 0.35} 100 ${y - h} Q${100 + w * 0.45} ${y - h * 0.35} ${100 + w} ${y} Q100 ${y + h * 0.16} ${100 - w} ${y}Z`}
              fill={c.rg(i % 2 ? '#34a96b' : '#2d9a60')}
              {...ol(c, '#2d9a60')}
            />
            <path d={`M${100 - w + 3} ${y - 1} Q${100 - w * 0.45} ${y - h * 0.36} 100 ${y - h + 2}`} fill="none" stroke="#fff" strokeOpacity={0.28} strokeWidth={1.6} strokeLinecap="round" />
            <path d={`M${100 - w * 0.5} ${y + 2} q${w * 0.2} -7 ${w * 0.4} 0 M${100 + w * 0.15} ${y + 3} q${w * 0.2} -7 ${w * 0.4} 0`} fill="none" stroke={darken(c.col('#2d9a60'), 0.3)} strokeOpacity={0.35} strokeWidth={1.2} strokeLinecap="round" />
          </Grow>
        </Sway>
      ))}
      <Grow ctx={c} a={0.88} b={1} ox={100} oy={30}>
        <g transform="translate(100 30)">
          <path d={star4(9)} fill={c.col('#fde047')} {...ol(c, '#f59e0b', 0.6)} />
        </g>
      </Grow>
      {[[88, 150], [112, 128], [92, 108]].map(([x, y], i) => (
        <Grow key={i} ctx={c} a={0.82 + i * 0.04} b={0.98} ox={x} oy={y}>
          <circle cx={x} cy={y} r={2.6} fill={c.col(['#ef4444', '#fbbf24', '#60a5fa'][i])} />
        </Grow>
      ))}
    </>
  );
};

const bush: Render = c => {
  const blobs = [[66, 162, 20], [134, 162, 20], [100, 160, 26], [84, 140, 21], [116, 140, 21], [100, 126, 18]] as const;
  const berries = [[78, 150], [122, 148], [100, 140], [92, 126], [112, 156], [68, 166], [132, 166]];
  return (
    <>
      <Canopy ctx={c} blobs={blobs} c="#4cae5c" colors={['#3f9f52', '#58b866', '#4cae5c']} a={0.1} b={0.6} />
      <Leaf ctx={c} x={100} y={118} len={16} rot={-75} c="#7ad27b" a={0.55} b={0.75} />
      <Leaf ctx={c} x={104} y={122} len={14} rot={-30} c="#7ad27b" a={0.58} b={0.78} d={-1} />
      <Leaf ctx={c} x={96} y={122} len={14} rot={-150} c="#7ad27b" a={0.58} b={0.78} d={-2} />
      {berries.map(([x, y], i) => (
        <Grow key={i} ctx={c} a={0.68 + i * 0.04} b={0.9 + i * 0.01} ox={x} oy={y}>
          <circle cx={x} cy={y} r={3.2} fill={c.rg('#e11d48')} />
          <circle cx={x - 1} cy={y - 1.1} r={0.9} fill="#fff" opacity={0.7} />
        </Grow>
      ))}
    </>
  );
};

const cherry: Render = c => {
  const blobs = [[100, 70, 28], [62, 96, 22], [138, 94, 22], [78, 76, 22], [122, 76, 22], [100, 100, 24]] as const;
  const blossoms = [[60, 90], [86, 66], [114, 62], [142, 88], [100, 88], [72, 108], [128, 106], [100, 50], [84, 90], [118, 88], [52, 100], [148, 100]];
  return (
    <>
      {trunk(c, 'M93 181 C97 160 94 140 97 120 L103 120 C106 140 103 160 107 181Z', '#7a4a3a', 0.04, 0.3)}
      <Stem ctx={c} d="M100 130 Q80 118 66 98" w={5} c="#7a4a3a" a={0.22} b={0.42} />
      <Stem ctx={c} d="M100 126 Q122 112 138 94" w={5} c="#7a4a3a" a={0.26} b={0.46} />
      <Stem ctx={c} d="M100 124 Q101 100 100 76" w={5} c="#7a4a3a" a={0.3} b={0.5} />
      <Sway ctx={c} ox={100} oy={120} a={1.6} d={-1}>
        <Canopy ctx={c} blobs={blobs} c="#f9a8d4" colors={['#f9a8d4', '#f472b6', '#fbcfe8']} a={0.35} b={0.85} />
        {blossoms.map(([x, y], i) => (
          <Grow key={i} ctx={c} a={0.6 + i * 0.03} b={0.85 + i * 0.012} ox={x} oy={y}>
            <g transform={`translate(${x} ${y}) rotate(${i * 31})`}>
              {[0, 72, 144, 216, 288].map(r => <path key={r} d={PETAL} transform={`rotate(${r}) scale(.62)`} fill={c.col('#fff1f5')} stroke={c.col('#f9a8d4')} strokeWidth={0.6} />)}
              <circle r={1.1} fill={c.col('#e11d48')} />
            </g>
          </Grow>
        ))}
      </Sway>
      {!c.dead && <Fallers ctx={c} items={[[70, 104], [96, 108], [128, 104], [84, 96], [112, 100], [142, 98]]} shape={PETAL} colors={['#fbcfe8', '#f9a8d4', '#fff1f5']} scale={0.8} dy={78} />}
      <Butterfly ctx={c} x={50} y={118} c="#a78bfa" show={c.s > 0.85} />
    </>
  );
};

const sunflower: Render = c => {
  const hx = 100, hy = 74;
  const seeds = Array.from({ length: 24 }, (_, i) => {
    const r = 2.2 * Math.sqrt(i + 1), a = i * 2.39996;
    return [Math.cos(a) * r, Math.sin(a) * r] as const;
  });
  return (
    <>
      <Stem ctx={c} d="M100 181 C97 150 104 120 100 88" w={6} c="#3f9d4f" a={0.08} b={0.58} />
      <Leaf ctx={c} x={100} y={152} len={36} rot={-28} c="#4db35c" a={0.2} b={0.45} w={0.42} />
      <Leaf ctx={c} x={100} y={130} len={34} rot={-152} c="#43a653" a={0.26} b={0.5} w={0.42} d={-1.5} />
      <Sway ctx={c} ox={100} oy={96} a={2.2} t={6}>
        <Grow ctx={c} a={0.55} b={0.95} ox={hx} oy={92} droop={80}>
          <g transform={`translate(${hx} ${hy}) rotate(-6)`}>
            {Array.from({ length: 18 }, (_, i) => (
              <ellipse key={`b${i}`} cy={-24} rx={5.2} ry={12} transform={`rotate(${i * 20 + 10})`} fill={c.col('#f59e0b')} {...ol(c, '#f59e0b', 0.5)} />
            ))}
            {Array.from({ length: 18 }, (_, i) => (
              <ellipse key={`f${i}`} cy={-22} rx={5.4} ry={12.5} transform={`rotate(${i * 20})`} fill={c.rg('#fcd34d')} {...ol(c, '#f59e0b', 0.5)} />
            ))}
            <circle r={15} fill={c.rg('#7c4a21')} {...ol(c, '#7c4a21', 1)} />
            <circle r={10} fill={c.col('#5a3416')} opacity={0.5} />
            {seeds.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={0.9} fill={c.col('#d9a15d')} opacity={0.75} />)}
          </g>
        </Grow>
      </Sway>
      <Bee ctx={c} x={128} y={76} show={c.s > 0.85} />
    </>
  );
};

const mapleBlobs = [[100, 66, 30], [60, 94, 24], [140, 94, 24], [80, 72, 24], [122, 72, 24], [100, 100, 26]] as const;
const maple: Render = c => {
  const leaves = [[62, 90], [88, 58], [118, 56], [142, 90], [100, 84], [74, 108], [128, 106], [104, 40], [52, 104], [150, 104]];
  const cols = ['#dc2626', '#f97316', '#f59e0b', '#ea580c', '#b91c1c'];
  return (
    <>
      {trunk(c, 'M92 181 C97 160 94 140 96 120 L104 120 C106 140 103 160 108 181Z', '#6e4a31', 0.04, 0.3)}
      <Stem ctx={c} d="M99 130 Q80 116 64 96" w={5.5} c="#6e4a31" a={0.22} b={0.42} />
      <Stem ctx={c} d="M101 126 Q122 112 138 94" w={5.5} c="#6e4a31" a={0.26} b={0.46} />
      <Sway ctx={c} ox={100} oy={120} a={1.5} d={-0.5}>
        <Canopy ctx={c} blobs={mapleBlobs} c="#ea580c" colors={['#d9341f', '#f06a1a', '#f59e0b', '#e8501a']} a={0.35} b={0.88} />
        {leaves.map(([x, y], i) => (
          <Grow key={i} ctx={c} a={0.55 + i * 0.035} b={0.82 + i * 0.02} ox={x} oy={y}>
            <path d={MAPLE_LEAF} transform={`translate(${x} ${y}) rotate(${i * 37}) scale(${0.85 + (i % 3) * 0.2})`} fill={c.col(cols[i % cols.length])} stroke={c.col('#7f1d1d')} strokeOpacity={0.4} strokeWidth={0.6} />
          </Grow>
        ))}
      </Sway>
      {!c.dead && <Fallers ctx={c} items={[[70, 106], [100, 112], [132, 106], [86, 98], [118, 100]]} shape={MAPLE_LEAF} colors={['#dc2626', '#f97316', '#f59e0b']} scale={0.55} dy={74} />}
    </>
  );
};

const baobab: Render = c => (
  <>
    {trunk(c, 'M70 181 C82 170 88 150 86 122 C84 100 82 92 88 84 L112 84 C118 92 116 100 114 122 C112 150 118 170 130 181Z', '#b0825a', 0.04, 0.45)}
    <Grow ctx={c} a={0.1} b={0.45} ox={100} oy={B} axis="y">
      <path d="M92 100 C90 130 92 160 88 176 M104 96 C106 130 104 150 108 176 M98 110 C96 140 98 160 96 176" fill="none" stroke={c.col('#6e4a31')} strokeOpacity={0.3} strokeWidth={1.4} strokeLinecap="round" />
    </Grow>
    <Stem ctx={c} d="M92 86 Q78 74 62 66" w={6} c="#8a5f3d" a={0.4} b={0.58} />
    <Stem ctx={c} d="M108 86 Q122 74 140 66" w={6} c="#8a5f3d" a={0.44} b={0.62} />
    <Stem ctx={c} d="M100 86 Q101 70 100 54" w={6} c="#8a5f3d" a={0.48} b={0.66} />
    <Sway ctx={c} ox={100} oy={90} a={1.2}>
      <Canopy ctx={c} blobs={[[58, 60, 16], [80, 52, 18], [100, 44, 19], [122, 52, 18], [142, 60, 16], [100, 64, 16]]} c="#6ab04c" colors={['#5aa343', '#6ab04c', '#7cc152']} sy={0.72} a={0.5} b={0.95} />
      {[[72, 80], [130, 78], [100, 76]].map(([x, y], i) => (
        <Grow key={i} ctx={c} a={0.85 + i * 0.03} b={1} ox={x} oy={y - 8}>
          <path d={`M${x} ${y - 8} V${y}`} stroke={c.col('#5b4630')} strokeWidth={1} />
          <ellipse cx={x} cy={y + 5} rx={3.4} ry={6} fill={c.rg('#a3865a')} {...ol(c, '#a3865a', 0.6)} />
        </Grow>
      ))}
    </Sway>
  </>
);

/* ---------- specials ---------- */

const crystal: Render = c => {
  const shards = [[-62, 56], [62, 56], [-38, 72], [38, 72], [-14, 84], [14, 84], [0, 96]] as const;
  const cols = ['#a78bfa', '#67e8f9', '#f0abfc', '#bae6fd', '#67e8f9', '#a78bfa', '#c4b5fd'];
  return (
    <>
      <Aura c={c} x={100} y={90} r={70} color="#67e8f9" a={0.35} b={0.8} />
      {trunk(c, 'M92 181 L97 122 L103 122 L108 181Z', '#8aa0c0', 0.04, 0.3)}
      {shards.map(([ang, len], i) => {
        const w = 11 + (i === 6 ? 3 : 0);
        const col = c.col(cols[i]);
        return (
          <g key={i} transform={`translate(100 124) rotate(${ang})`}>
            <Sway ctx={c} ox={0} oy={0} a={1.4} t={4.5} d={-i * 0.6}>
              <Grow ctx={c} a={0.28 + i * 0.07} b={0.62 + i * 0.05} ox={0} oy={0} sink={6}>
                <path d={`M0 0 L${-w} ${-len * 0.45} L0 ${-len}Z`} fill={darken(col, 0.12)} stroke="#fff" strokeOpacity={0.5} strokeWidth={0.7} strokeLinejoin="round" />
                <path d={`M0 0 L${w} ${-len * 0.45} L0 ${-len}Z`} fill={lighten(col, 0.35)} stroke="#fff" strokeOpacity={0.5} strokeWidth={0.7} strokeLinejoin="round" />
                <path d={`M0 ${-len * 0.2} L0 ${-len * 0.9}`} stroke="#fff" strokeOpacity={0.45} strokeWidth={0.8} />
              </Grow>
            </Sway>
          </g>
        );
      })}
      {[[52, 70, 0], [150, 56, 1], [128, 30, 2], [70, 40, 3]].map(([x, y, i]) => (
        <Grow key={i} ctx={c} a={0.7 + i * 0.06} b={0.95} ox={x} oy={y}>
          <g transform={`translate(${x} ${y})`}>
            <g className={c.anim && !c.dead && !c.lite ? 'pl-float' : undefined} style={cv({ '--d': `${-i * 0.9}s` })}>
              <path d="M0 -6 L4 0 L0 6 L-4 0Z" fill={c.rg('#c4b5fd')} stroke="#fff" strokeOpacity={0.6} strokeWidth={0.6} />
            </g>
          </g>
        </Grow>
      ))}
      {c.s > 0.7 && (
        <>
          <Twinkle ctx={c} x={100} y={26} r={5} c="#ffffff" />
          <Twinkle ctx={c} x={64} y={92} r={4} c="#e0f2fe" d={-1} t={3.2} />
          <Twinkle ctx={c} x={140} y={104} r={4} c="#f5d0fe" d={-2} t={2.9} />
        </>
      )}
    </>
  );
};

const starry: Render = c => {
  const stars = [[70, 92, 4], [96, 76, 5], [122, 60, 4], [140, 100, 4.5], [100, 50, 3.5], [80, 62, 3.5], [108, 100, 4], [60, 110, 3], [128, 84, 3.5]];
  return (
    <>
      <Aura c={c} x={100} y={80} r={72} color="#fde047" a={0.4} b={0.85} />
      {trunk(c, 'M93 181 C97 160 95 140 97 120 L103 120 C105 140 103 160 107 181Z', '#4b3b7c', 0.04, 0.3)}
      <Stem ctx={c} d="M100 130 Q82 118 70 100" w={4.5} c="#4b3b7c" a={0.22} b={0.42} />
      <Stem ctx={c} d="M100 126 Q120 112 134 98" w={4.5} c="#4b3b7c" a={0.26} b={0.46} />
      <Sway ctx={c} ox={100} oy={120} a={1.4} d={-1}>
        <Canopy ctx={c} blobs={[[100, 50, 22], [80, 64, 24], [120, 64, 24], [62, 100, 24], [138, 100, 24], [100, 86, 32]]} c="#4338ca" colors={['#3730a3', '#5b21b6', '#312e81', '#4c1d95']} a={0.35} b={0.88} />
        {stars.map(([x, y, r], i) => (
          <Grow key={i} ctx={c} a={0.55 + i * 0.04} b={0.8 + i * 0.02} ox={x} oy={y}>
            <Twinkle ctx={c} x={x} y={y} r={r} c={i % 3 ? '#fde047' : '#fff7ae'} d={-i * 0.45} t={2.2 + (i % 3) * 0.6} />
          </Grow>
        ))}
      </Sway>
      <Grow ctx={c} a={0.85} b={1} ox={146} oy={44}>
        <g className={c.anim && !c.dead && !c.lite ? 'pl-float' : undefined}>
          <path d="M142 32 a14 14 0 1 0 12 22 a11 11 0 1 1 -12 -22Z" fill={c.rg('#fde047')} {...ol(c, '#f59e0b', 0.5)} />
        </g>
      </Grow>
    </>
  );
};

/* ---------- new species ---------- */

const tulip: Render = c => {
  const fl = [{ x: 100, top: 94, col: '#f43f5e', bx: 100 }, { x: 72, top: 116, col: '#f59e0b', bx: 88 }, { x: 128, top: 124, col: '#ec4899', bx: 112 }];
  return (
    <>
      <Leaf ctx={c} x={96} y={B} len={78} rot={-112} c="#3fa55a" a={0.08} b={0.4} w={0.14} />
      <Leaf ctx={c} x={104} y={B} len={74} rot={-70} c="#4db36a" a={0.12} b={0.44} w={0.14} d={-1} />
      <Leaf ctx={c} x={90} y={B} len={56} rot={-135} c="#43a65e" a={0.16} b={0.46} w={0.16} d={-2} />
      <Leaf ctx={c} x={110} y={B} len={54} rot={-48} c="#43a65e" a={0.18} b={0.48} w={0.16} d={-3} />
      {fl.map((f, i) => (
        <Sway key={i} ctx={c} ox={f.bx} oy={B} a={2.4 + i * 0.4} t={4.5 + i * 0.7} d={-i}>
          <Stem ctx={c} d={`M${f.bx} 181 C${f.bx} 156 ${f.x} 140 ${f.x} ${f.top}`} w={4} c="#3f9d4f" a={0.1 + i * 0.05} b={0.52 + i * 0.04} />
          <Grow ctx={c} a={0.5 + i * 0.1} b={0.85 + i * 0.05} ox={f.x} oy={f.top} droop={i % 2 ? -50 : 50}>
            <g transform={`translate(${f.x} ${f.top})`}>
              <path d="M-11 0 C-13 -16 -6 -24 0 -28 C6 -24 13 -16 11 0 C6 6 -6 6 -11 0Z" fill={c.rg(f.col)} {...ol(c, f.col)} />
              <path d="M-4.5 5 C-11 -4 -8 -18 0 -27 C8 -18 11 -4 4.5 5 C2 6 -2 6 -4.5 5Z" fill={c.col(lighten(f.col, 0.28))} opacity={0.75} />
              <path d="M0 -28 L-3.5 -6 M0 -28 L3.5 -6" stroke={c.col(darken(f.col, 0.3))} strokeOpacity={0.35} strokeWidth={0.8} />
              <ellipse cx={-4} cy={-14} rx={1.6} ry={5} fill="#fff" opacity={0.28} transform="rotate(10 -4 -14)" />
            </g>
          </Grow>
        </Sway>
      ))}
      <Butterfly ctx={c} x={142} y={100} c="#fbbf24" show={c.s > 0.8} />
    </>
  );
};

const bamboo: Render = c => {
  const culms = [{ x: 82, h: 128, w: 9, a: 0.1, tilt: -2.5 }, { x: 100, h: 160, w: 11, a: 0.03, tilt: 0.5 }, { x: 118, h: 108, w: 8, a: 0.16, tilt: 3 }];
  return (
    <>
      {culms.map((m, i) => {
        const nodes = Math.floor(m.h / 26);
        return (
          <g key={i} transform={`rotate(${m.tilt} ${m.x} ${B})`}>
            <Sway ctx={c} ox={m.x} oy={B} a={1.4 + i * 0.3} t={4 + i * 0.8} d={-i * 1.2}>
              <Grow ctx={c} a={m.a} b={m.a + 0.55} ox={m.x} oy={B} axis="y">
                <rect x={m.x - m.w / 2} y={B - m.h} width={m.w} height={m.h} rx={m.w / 2} fill={c.lg(i === 1 ? '#7fd06c' : '#6cc15f')} {...ol(c, '#4fa64a')} />
                {Array.from({ length: nodes }, (_, k) => (
                  <rect key={k} x={m.x - m.w / 2 - 0.8} y={B - 24 - k * 26} width={m.w + 1.6} height={3} rx={1.5} fill={c.col('#3f8f3f')} opacity={0.85} />
                ))}
              </Grow>
              {Array.from({ length: Math.min(3, nodes) }, (_, k) => {
                const y = B - 24 - (nodes - 1 - k) * 26;
                return (
                  <g key={k}>
                    <Leaf ctx={c} x={m.x} y={y} len={26} rot={-38 - k * 6} c="#4eb56a" a={0.6 + k * 0.08} b={0.85 + k * 0.05} w={0.2} d={-k} />
                    <Leaf ctx={c} x={m.x} y={y} len={24} rot={-142 + k * 6} c="#67c86e" a={0.63 + k * 0.08} b={0.88 + k * 0.05} w={0.2} d={-k - 1} />
                  </g>
                );
              })}
            </Sway>
          </g>
        );
      })}
    </>
  );
};

const cactus: Render = c => {
  const bloom = (x: number, y: number, r: number, a: number, b: number) => (
    <Grow ctx={c} a={a} b={b} ox={x} oy={y}>
      <g transform={`translate(${x} ${y})`}>
        {Array.from({ length: 6 }, (_, i) => <ellipse key={i} cy={-r} rx={r * 0.5} ry={r} transform={`rotate(${i * 60})`} fill={c.rg('#f472b6')} stroke={c.col('#be185d')} strokeOpacity={0.35} strokeWidth={0.5} />)}
        <circle r={r * 0.4} fill={c.col('#fde047')} />
      </g>
    </Grow>
  );
  const spines = [[94, 80], [106, 96], [95, 112], [105, 128], [94, 144], [106, 160], [96, 170]];
  return (
    <>
      <Sway ctx={c} ox={100} oy={B} a={0.7} t={7}>
        <Grow ctx={c} a={0.05} b={0.5} ox={100} oy={B} axis="y">
          <rect x={87} y={64} width={26} height={118} rx={13} fill={c.lg('#3fa86b')} {...ol(c, '#2f8a55', 1)} />
          <path d="M94 74 V176 M100 68 V178 M106 74 V176" stroke={c.col('#1f6b42')} strokeOpacity={0.3} strokeWidth={1.2} strokeLinecap="round" />
          {spines.map(([x, y], i) => <path key={i} d={`M${x} ${y} l${x < 100 ? -3 : 3} -2.4 M${x} ${y} l${x < 100 ? -3 : 3} 1.6`} stroke="#fef3c7" strokeWidth={0.8} strokeLinecap="round" opacity={0.85} />)}
        </Grow>
        <Stem ctx={c} d="M90 142 Q68 142 68 120 V104" w={12} c="#3fa86b" a={0.42} b={0.7} />
        <Stem ctx={c} d="M110 124 Q132 124 132 102 V90" w={11} c="#46b073" a={0.5} b={0.76} />
        {bloom(100, 62, 7, 0.8, 1)}
        {bloom(68, 100, 4.5, 0.84, 1)}
        {bloom(132, 86, 4.5, 0.88, 1)}
      </Sway>
    </>
  );
};

const lotus: Render = c => {
  const layers = [
    { angs: [-72, -36, 0, 36, 72], k: 1, col: '#f9a8d4', a: 0.52 },
    { angs: [-54, -18, 18, 54], k: 0.86, col: '#f472b6', a: 0.6 },
    { angs: [-30, 0, 30], k: 0.68, col: '#fbcfe8', a: 0.68 },
  ];
  const pads = [[56, 174, 21], [148, 172, 17], [118, 184, 13]];
  const bx = 100, by = 114;
  return (
    <>
      <ellipse cx={100} cy={176} rx={84} ry={16} fill={c.rg('#3aa6c9')} {...ol(c, '#3aa6c9', 1)} />
      <ellipse cx={92} cy={172} rx={52} ry={6} fill="#fff" opacity={0.18} />
      {c.anim && !c.lite && !c.dead && [0, -1.8].map(d => (
        <ellipse key={d} className="pl-ripple" cx={100} cy={178} rx={50} ry={9} fill="none" stroke="#fff" strokeWidth={1} style={cv({ '--d': `${d}s`, transformOrigin: '100px 178px' })} />
      ))}
      {pads.map(([x, y, r], i) => (
        <Grow key={i} ctx={c} a={0.02 + i * 0.05} b={0.3 + i * 0.05} ox={x} oy={y}>
          <ellipse cx={x} cy={y} rx={r} ry={r * 0.36} fill={c.rg('#3f9d54')} {...ol(c, '#3f9d54')} />
          <path d={`M${x} ${y} L${x + r * 0.9} ${y - r * 0.12}`} stroke={c.col('#bbf7d0')} strokeOpacity={0.5} strokeWidth={0.8} />
        </Grow>
      ))}
      <Sway ctx={c} ox={100} oy={176} a={1.4} t={6}>
        <Stem ctx={c} d="M100 176 C98 156 102 134 100 114" w={4.5} c="#3f9d54" a={0.1} b={0.5} />
        <Aura c={c} x={bx} y={by - 16} r={34} color="#f9a8d4" a={0.85} b={1} />
        {layers.map((L, li) =>
          L.angs.map((ang, pi) => (
            <g key={`${li}-${pi}`} transform={`translate(${bx} ${by}) rotate(${ang}) scale(${L.k})`}>
              <Grow ctx={c} a={L.a + pi * 0.015} b={L.a + 0.22 + pi * 0.015} ox={0} oy={0} droop={ang < 0 ? -40 : 40}>
                <path d="M0 0 C-14 -8 -14 -32 0 -46 C14 -32 14 -8 0 0Z" fill={c.rg(L.col)} stroke={c.col('#be185d')} strokeOpacity={0.3} strokeWidth={0.7} />
                <path d="M0 -4 L0 -36" stroke="#fff" strokeOpacity={0.4} strokeWidth={0.8} />
              </Grow>
            </g>
          )),
        )}
        <Grow ctx={c} a={0.82} b={1} ox={bx} oy={by - 4}>
          <circle cx={bx} cy={by - 6} r={4.5} fill={c.rg('#fde047')} />
        </Grow>
      </Sway>
    </>
  );
};

const bonsai: Render = c => {
  const pads = [[66, 116, 22], [128, 86, 23], [96, 66, 24], [112, 104, 16]] as const;
  return (
    <>
      <ellipse cx={100} cy={159} rx={31} ry={3.4} fill={c.col('#5b3a1e')} />
      <Stem ctx={c} d="M100 160 C96 148 82 144 88 128 C94 112 114 116 110 98 C107 86 98 84 94 78" w={8} c="#7b5237" a={0.08} b={0.55} />
      <Stem ctx={c} d="M92 132 C78 128 70 124 68 116" w={4} c="#7b5237" a={0.35} b={0.55} />
      <Stem ctx={c} d="M108 104 C122 100 128 94 130 86" w={4} c="#7b5237" a={0.4} b={0.6} />
      <Sway ctx={c} ox={100} oy={150} a={1.3} d={-0.5}>
        <Canopy ctx={c} blobs={pads} c="#4cae68" colors={['#3d9a5b', '#4cae68', '#58bb72', '#3d9a5b']} sy={0.58} a={0.35} b={0.92} />
        {[[56, 112], [136, 82], [104, 62]].map(([x, y], i) => (
          <Grow key={i} ctx={c} a={0.86 + i * 0.03} b={1} ox={x} oy={y}>
            <circle cx={x} cy={y} r={2.2} fill={c.col('#fbcfe8')} stroke={c.col('#f472b6')} strokeWidth={0.6} />
          </Grow>
        ))}
      </Sway>
      {!c.dead && <Fallers ctx={c} items={[[70, 126], [124, 96], [100, 78]]} shape="M0 -5 C3 -3 3 2 0 5 C-3 2 -3 -3 0 -5Z" colors={['#58bb72', '#fbcfe8']} dy={60} />}
      <path d="M68 163 L76 181 H124 L132 163Z" fill={c.lg('#c2693b')} {...ol(c, '#c2693b')} />
      <rect x={63} y={157} width={74} height={8} rx={3.5} fill={c.lg('#d9794a')} {...ol(c, '#c2693b')} />
      <path d="M80 170 H120" stroke="#fff" strokeOpacity={0.25} strokeWidth={1.4} strokeLinecap="round" />
    </>
  );
};

const palm: Render = c => {
  const ys = Array.from({ length: 11 }, (_, i) => B - i * 9.8);
  const cx = (y: number) => 96 + 20 * Math.pow((B - y) / 100, 1.4);
  const wd = (y: number) => 10 - 4 * ((B - y) / 100);
  const L = ys.map(y => [cx(y) - wd(y) / 2, y] as const);
  const R = ys.map(y => [cx(y) + wd(y) / 2, y] as const);
  const d = `M${L.map(p => p.join(' ')).join(' L')} L${[...R].reverse().map(p => p.join(' ')).join(' L')}Z`;
  const topX = cx(ys[ys.length - 1]), topY = ys[ys.length - 1];
  const fronds = [[1, -62], [1, -30], [1, 4], [-1, -62], [-1, -30], [-1, 4], [1, -94]] as const;
  return (
    <>
      <Grow ctx={c} a={0.05} b={0.5} ox={100} oy={B} axis="y">
        <path d={d} fill={c.lg('#a97c50')} {...ol(c, '#a97c50')} />
        {ys.slice(1, -1).map((y, i) => <path key={i} d={`M${L[i + 1][0]} ${y} Q${cx(y)} ${y + 2.5} ${R[i + 1][0]} ${y}`} fill="none" stroke={c.col('#5b3d22')} strokeOpacity={0.4} strokeWidth={1} />)}
      </Grow>
      <Sway ctx={c} ox={100} oy={B} a={1.6} t={6}>
        {fronds.map(([dir, ang], i) => (
          <g key={i} transform={`translate(${topX} ${topY}) scale(${dir} 1) rotate(${ang})`}>
            <Sway ctx={c} ox={0} oy={0} a={2.5} t={3.8 + (i % 3)} d={-i * 0.8}>
              <Grow ctx={c} a={0.42 + i * 0.05} b={0.78 + i * 0.03} ox={0} oy={0} droop={dir * 35}>
                <path d="M0 0 C16 -26 46 -30 72 -2 C48 -16 18 -12 0 0Z" fill={c.rg(i % 2 ? '#3f9d54' : '#4cb063')} {...ol(c, '#3f9d54', 0.7)} />
                <path d="M2 -1 C18 -22 46 -26 68 -3" fill="none" stroke={c.col('#bbf7d0')} strokeOpacity={0.5} strokeWidth={0.9} strokeLinecap="round" />
              </Grow>
            </Sway>
          </g>
        ))}
        {[[-5, 6], [4, 7], [-1, 12]].map(([dx, dy], i) => (
          <Grow key={i} ctx={c} a={0.8 + i * 0.04} b={1} ox={topX + dx} oy={topY + dy}>
            <circle cx={topX + dx} cy={topY + dy} r={4.6} fill={c.rg('#8b5e3c')} {...ol(c, '#8b5e3c', 0.7)} />
          </Grow>
        ))}
      </Sway>
    </>
  );
};

export const RENDERERS: Record<string, { render: Render; baseY?: number; sway?: number }> = {
  cedar: { render: cedar },
  bush: { render: bush },
  cherry: { render: cherry },
  sunflower: { render: sunflower },
  maple: { render: maple },
  baobab: { render: baobab },
  crystal: { render: crystal },
  starry: { render: starry },
  tulip: { render: tulip },
  bamboo: { render: bamboo },
  cactus: { render: cactus },
  lotus: { render: lotus },
  bonsai: { render: bonsai, baseY: 160, sway: 0.3 },
  palm: { render: palm },
};
