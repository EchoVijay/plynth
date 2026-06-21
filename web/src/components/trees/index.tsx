// Tree SVG components for the Focus Timer.
// Each tree accepts `stage` (0-1 growth progress), `dead` (boolean), and `size`.

import { motion } from 'framer-motion';

interface TreeProps {
  stage: number;   // 0 = seed, 1 = full maturity
  dead?: boolean;
  size?: number;
}

const T = { duration: 0.8, ease: 'easeOut' as const };

// Shared soil/ground base
function Soil({ size }: { size: number }) {
  const w = size, cy = size * 0.92;
  return (
    <ellipse cx={w / 2} cy={cy} rx={w * 0.3} ry={w * 0.06}
      className="fill-amber-800/40 dark:fill-amber-900/50" />
  );
}

// ==================== CEDAR ====================
export function Cedar({ stage, dead, size = 120 }: TreeProps) {
  const s = Math.max(0, Math.min(1, stage));
  const cx = size / 2;
  const color = dead ? '#9ca3af' : `hsl(${140 + s * 10}, ${50 + s * 20}%, ${30 + s * 10}%)`;
  const trunkH = s * size * 0.35;
  const canopyH = s * size * 0.5;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Soil size={size} />
      {/* Trunk */}
      <motion.rect x={cx - size * 0.03} y={size * 0.9 - trunkH} width={size * 0.06} rx={2}
        initial={{ height: 0 }} animate={{ height: trunkH }}
        transition={T} fill={dead ? '#6b7280' : '#92400e'} />
      {/* Triangular canopy layers */}
      {s > 0.2 && (
        <motion.polygon
          points={`${cx},${size * 0.9 - trunkH - canopyH} ${cx - size * 0.25 * s},${size * 0.9 - trunkH} ${cx + size * 0.25 * s},${size * 0.9 - trunkH}`}
          initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }}
          transition={{ ...T, delay: 0.2 }} fill={color} />
      )}
      {s > 0.5 && (
        <motion.polygon
          points={`${cx},${size * 0.9 - trunkH - canopyH * 0.85} ${cx - size * 0.2 * s},${size * 0.9 - trunkH - canopyH * 0.2} ${cx + size * 0.2 * s},${size * 0.9 - trunkH - canopyH * 0.2}`}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          transition={{ ...T, delay: 0.4 }}
          fill={dead ? '#6b7280' : `hsl(${135 + s * 15}, ${55 + s * 15}%, ${35 + s * 8}%)`} />
      )}
      {/* Seed/sprout at very early stages */}
      {s > 0 && s < 0.2 && (
        <motion.circle cx={cx} cy={size * 0.87} r={size * 0.025}
          initial={{ scale: 0 }} animate={{ scale: 1 }}
          fill={dead ? '#9ca3af' : '#16a34a'} />
      )}
    </svg>
  );
}

// ==================== BUSH ====================
export function Bush({ stage, dead, size = 120 }: TreeProps) {
  const s = Math.max(0, Math.min(1, stage));
  const cx = size / 2;
  const r = s * size * 0.28;
  const color = dead ? '#9ca3af' : `hsl(${130 + s * 15}, ${45 + s * 25}%, ${35 + s * 12}%)`;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Soil size={size} />
      {s > 0 && s < 0.15 && (
        <motion.circle cx={cx} cy={size * 0.87} r={size * 0.02}
          initial={{ scale: 0 }} animate={{ scale: 1 }} fill={dead ? '#9ca3af' : '#16a34a'} />
      )}
      {s >= 0.15 && (
        <>
          <motion.ellipse cx={cx} cy={size * 0.75 - r * 0.3} rx={r} ry={r * 0.85}
            initial={{ scale: 0 }} animate={{ scale: 1 }} transition={T} fill={color} />
          {s > 0.5 && (
            <>
              <motion.ellipse cx={cx - r * 0.5} cy={size * 0.78 - r * 0.2} rx={r * 0.6} ry={r * 0.5}
                initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...T, delay: 0.2 }}
                fill={dead ? '#6b7280' : `hsl(135, ${55 + s * 20}%, ${32 + s * 10}%)`} />
              <motion.ellipse cx={cx + r * 0.5} cy={size * 0.78 - r * 0.2} rx={r * 0.6} ry={r * 0.5}
                initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...T, delay: 0.3 }}
                fill={dead ? '#6b7280' : `hsl(125, ${50 + s * 20}%, ${30 + s * 12}%)`} />
            </>
          )}
        </>
      )}
    </svg>
  );
}

// ==================== CHERRY BLOSSOM ====================
export function CherryBlossom({ stage, dead, size = 120 }: TreeProps) {
  const s = Math.max(0, Math.min(1, stage));
  const cx = size / 2;
  const trunkH = s * size * 0.4;
  const canopyR = s * size * 0.25;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Soil size={size} />
      {s > 0 && s < 0.15 && (
        <motion.circle cx={cx} cy={size * 0.87} r={size * 0.02}
          initial={{ scale: 0 }} animate={{ scale: 1 }} fill={dead ? '#9ca3af' : '#f9a8d4'} />
      )}
      {s >= 0.15 && (
        <>
          {/* Trunk — slightly curved */}
          <motion.rect x={cx - size * 0.025} y={size * 0.9 - trunkH} width={size * 0.05} rx={2}
            initial={{ height: 0 }} animate={{ height: trunkH }}
            transition={T} fill={dead ? '#6b7280' : '#78350f'} />
          {/* Branches */}
          {s > 0.4 && (
            <>
              <motion.line x1={cx} y1={size * 0.9 - trunkH * 0.6} x2={cx - size * 0.15} y2={size * 0.9 - trunkH * 0.8}
                stroke={dead ? '#6b7280' : '#78350f'} strokeWidth={2.5}
                initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={T} />
              <motion.line x1={cx} y1={size * 0.9 - trunkH * 0.7} x2={cx + size * 0.15} y2={size * 0.9 - trunkH * 0.9}
                stroke={dead ? '#6b7280' : '#78350f'} strokeWidth={2.5}
                initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ ...T, delay: 0.15 }} />
            </>
          )}
          {/* Blossom clouds */}
          {s > 0.35 && (
            <>
              <motion.ellipse cx={cx} cy={size * 0.9 - trunkH - canopyR * 0.3} rx={canopyR} ry={canopyR * 0.7}
                initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                transition={{ ...T, delay: 0.3 }}
                fill={dead ? '#d1d5db' : '#fbcfe8'} />
              {s > 0.6 && (
                <>
                  <motion.ellipse cx={cx - canopyR * 0.6} cy={size * 0.9 - trunkH - canopyR * 0.1} rx={canopyR * 0.5} ry={canopyR * 0.4}
                    initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...T, delay: 0.4 }}
                    fill={dead ? '#e5e7eb' : '#f9a8d4'} />
                  <motion.ellipse cx={cx + canopyR * 0.6} cy={size * 0.9 - trunkH - canopyR * 0.1} rx={canopyR * 0.5} ry={canopyR * 0.4}
                    initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...T, delay: 0.45 }}
                    fill={dead ? '#e5e7eb' : '#f472b6'} />
                </>
              )}
            </>
          )}
          {/* Falling petals at maturity */}
          {s > 0.9 && !dead && [0, 1, 2].map(i => (
            <motion.circle key={i} r={2}
              cx={cx + (i - 1) * size * 0.12}
              initial={{ cy: size * 0.4, opacity: 1 }}
              animate={{ cy: size * 0.95, opacity: 0 }}
              transition={{ duration: 3, delay: i * 0.8, repeat: Infinity, ease: 'linear' }}
              fill="#f9a8d4" />
          ))}
        </>
      )}
    </svg>
  );
}

// ==================== SUNFLOWER ====================
export function Sunflower({ stage, dead, size = 120 }: TreeProps) {
  const s = Math.max(0, Math.min(1, stage));
  const cx = size / 2;
  const stemH = s * size * 0.55;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Soil size={size} />
      {s > 0 && s < 0.15 && (
        <motion.circle cx={cx} cy={size * 0.87} r={size * 0.02}
          initial={{ scale: 0 }} animate={{ scale: 1 }} fill={dead ? '#9ca3af' : '#16a34a'} />
      )}
      {s >= 0.15 && (
        <>
          {/* Stem */}
          <motion.rect x={cx - 2} y={size * 0.9 - stemH} width={4} rx={2}
            initial={{ height: 0 }} animate={{ height: stemH }}
            transition={T} fill={dead ? '#6b7280' : '#15803d'} />
          {/* Leaves */}
          {s > 0.3 && (
            <>
              <motion.ellipse cx={cx - size * 0.08} cy={size * 0.9 - stemH * 0.4} rx={size * 0.06} ry={size * 0.025}
                initial={{ scale: 0 }} animate={{ scale: 1, rotate: -20 }}
                transition={{ ...T, delay: 0.2 }} fill={dead ? '#9ca3af' : '#22c55e'} />
              <motion.ellipse cx={cx + size * 0.08} cy={size * 0.9 - stemH * 0.6} rx={size * 0.06} ry={size * 0.025}
                initial={{ scale: 0 }} animate={{ scale: 1, rotate: 20 }}
                transition={{ ...T, delay: 0.3 }} fill={dead ? '#9ca3af' : '#16a34a'} />
            </>
          )}
          {/* Flower head */}
          {s > 0.5 && (
            <>
              {/* Petals */}
              {Array.from({ length: 8 }, (_, i) => {
                const angle = (i / 8) * Math.PI * 2;
                const pr = s * size * 0.1;
                const px = cx + Math.cos(angle) * pr;
                const py = (size * 0.9 - stemH - size * 0.02) + Math.sin(angle) * pr;
                return (
                  <motion.ellipse key={i} cx={px} cy={py} rx={size * 0.04} ry={size * 0.02}
                    initial={{ scale: 0 }} animate={{ scale: 1, rotate: (angle * 180 / Math.PI) }}
                    transition={{ ...T, delay: 0.3 + i * 0.05 }}
                    fill={dead ? '#d1d5db' : '#fbbf24'} />
                );
              })}
              {/* Center */}
              <motion.circle cx={cx} cy={size * 0.9 - stemH - size * 0.02} r={size * 0.05 * s}
                initial={{ scale: 0 }} animate={{ scale: 1 }}
                transition={{ ...T, delay: 0.5 }}
                fill={dead ? '#6b7280' : '#92400e'} />
            </>
          )}
        </>
      )}
    </svg>
  );
}

// ==================== MAPLE ====================
export function Maple({ stage, dead, size = 120 }: TreeProps) {
  const s = Math.max(0, Math.min(1, stage));
  const cx = size / 2;
  const trunkH = s * size * 0.35;
  const canopyR = s * size * 0.28;
  const leafColor = dead ? '#9ca3af' : `hsl(${15 + s * 10}, ${70 + s * 20}%, ${45 + s * 10}%)`;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Soil size={size} />
      {s > 0 && s < 0.15 && (
        <motion.circle cx={cx} cy={size * 0.87} r={size * 0.02}
          initial={{ scale: 0 }} animate={{ scale: 1 }} fill={dead ? '#9ca3af' : '#ea580c'} />
      )}
      {s >= 0.15 && (
        <>
          <motion.rect x={cx - size * 0.03} y={size * 0.9 - trunkH} width={size * 0.06} rx={2}
            initial={{ height: 0 }} animate={{ height: trunkH }}
            transition={T} fill={dead ? '#6b7280' : '#78350f'} />
          {s > 0.3 && (
            <motion.ellipse cx={cx} cy={size * 0.9 - trunkH - canopyR * 0.5} rx={canopyR} ry={canopyR * 0.8}
              initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...T, delay: 0.2 }} fill={leafColor} />
          )}
          {s > 0.6 && (
            <>
              <motion.ellipse cx={cx - canopyR * 0.5} cy={size * 0.9 - trunkH - canopyR * 0.3} rx={canopyR * 0.55} ry={canopyR * 0.45}
                initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...T, delay: 0.3 }}
                fill={dead ? '#6b7280' : `hsl(25, 80%, 50%)`} />
              <motion.ellipse cx={cx + canopyR * 0.5} cy={size * 0.9 - trunkH - canopyR * 0.3} rx={canopyR * 0.55} ry={canopyR * 0.45}
                initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...T, delay: 0.35 }}
                fill={dead ? '#6b7280' : `hsl(5, 75%, 48%)`} />
            </>
          )}
          {/* Falling leaves */}
          {s > 0.9 && !dead && [0, 1].map(i => (
            <motion.circle key={i} r={2.5}
              cx={cx + (i === 0 ? -1 : 1) * size * 0.15}
              initial={{ cy: size * 0.35, opacity: 1 }}
              animate={{ cy: size * 0.95, opacity: 0, x: [0, (i === 0 ? -10 : 10), 0] }}
              transition={{ duration: 3.5, delay: i * 1.2, repeat: Infinity, ease: 'linear' }}
              fill="#ef4444" />
          ))}
        </>
      )}
    </svg>
  );
}

// ==================== BAOBAB ====================
export function Baobab({ stage, dead, size = 120 }: TreeProps) {
  const s = Math.max(0, Math.min(1, stage));
  const cx = size / 2;
  const trunkH = s * size * 0.4;
  const trunkW = s * size * 0.14;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Soil size={size} />
      {s > 0 && s < 0.15 && (
        <motion.circle cx={cx} cy={size * 0.87} r={size * 0.025}
          initial={{ scale: 0 }} animate={{ scale: 1 }} fill={dead ? '#9ca3af' : '#a16207'} />
      )}
      {s >= 0.15 && (
        <>
          {/* Fat trunk */}
          <motion.rect x={cx - trunkW / 2} y={size * 0.9 - trunkH} rx={trunkW * 0.3}
            width={trunkW} initial={{ height: 0 }} animate={{ height: trunkH }}
            transition={T} fill={dead ? '#6b7280' : '#92400e'} />
          {/* Wide flat canopy */}
          {s > 0.45 && (
            <motion.ellipse cx={cx} cy={size * 0.9 - trunkH - s * size * 0.08} rx={s * size * 0.3} ry={s * size * 0.12}
              initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...T, delay: 0.3 }}
              fill={dead ? '#9ca3af' : '#15803d'} />
          )}
          {s > 0.7 && (
            <motion.ellipse cx={cx} cy={size * 0.9 - trunkH - s * size * 0.12} rx={s * size * 0.22} ry={s * size * 0.09}
              initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...T, delay: 0.4 }}
              fill={dead ? '#6b7280' : '#166534'} />
          )}
        </>
      )}
    </svg>
  );
}

// ==================== CRYSTAL TREE ====================
export function CrystalTree({ stage, dead, size = 120 }: TreeProps) {
  const s = Math.max(0, Math.min(1, stage));
  const cx = size / 2;
  const h = s * size * 0.55;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Soil size={size} />
      {s > 0 && s < 0.15 && (
        <motion.circle cx={cx} cy={size * 0.87} r={size * 0.02}
          initial={{ scale: 0 }} animate={{ scale: 1 }} fill={dead ? '#9ca3af' : '#67e8f9'} />
      )}
      {s >= 0.15 && (
        <>
          <motion.rect x={cx - 2.5} y={size * 0.9 - h * 0.5} width={5} rx={1}
            initial={{ height: 0 }} animate={{ height: h * 0.5 }}
            transition={T} fill={dead ? '#6b7280' : '#a5f3fc'} />
          {s > 0.3 && (
            <motion.polygon
              points={`${cx},${size * 0.9 - h} ${cx - size * 0.18 * s},${size * 0.9 - h * 0.4} ${cx + size * 0.18 * s},${size * 0.9 - h * 0.4}`}
              initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 0.85 }}
              transition={{ ...T, delay: 0.2 }}
              fill={dead ? '#d1d5db' : '#22d3ee'} />
          )}
          {s > 0.6 && (
            <motion.polygon
              points={`${cx},${size * 0.9 - h * 0.95} ${cx - size * 0.12 * s},${size * 0.9 - h * 0.5} ${cx + size * 0.12 * s},${size * 0.9 - h * 0.5}`}
              initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 0.9 }}
              transition={{ ...T, delay: 0.35 }}
              fill={dead ? '#e5e7eb' : '#67e8f9'} />
          )}
          {/* Sparkles */}
          {s > 0.8 && !dead && [0, 1, 2].map(i => (
            <motion.circle key={i} r={1.5}
              cx={cx + (i - 1) * size * 0.1}
              cy={size * 0.5 - i * size * 0.08}
              initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0] }}
              transition={{ duration: 1.5, delay: i * 0.5, repeat: Infinity }}
              fill="#ffffff" />
          ))}
        </>
      )}
    </svg>
  );
}

// ==================== STARRY TREE ====================
export function StarryTree({ stage, dead, size = 120 }: TreeProps) {
  const s = Math.max(0, Math.min(1, stage));
  const cx = size / 2;
  const trunkH = s * size * 0.3;
  const canopyR = s * size * 0.25;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Soil size={size} />
      {s > 0 && s < 0.15 && (
        <motion.circle cx={cx} cy={size * 0.87} r={size * 0.02}
          initial={{ scale: 0 }} animate={{ scale: 1 }} fill={dead ? '#9ca3af' : '#a855f7'} />
      )}
      {s >= 0.15 && (
        <>
          <motion.rect x={cx - size * 0.025} y={size * 0.9 - trunkH} width={size * 0.05} rx={2}
            initial={{ height: 0 }} animate={{ height: trunkH }}
            transition={T} fill={dead ? '#6b7280' : '#581c87'} />
          {s > 0.3 && (
            <motion.ellipse cx={cx} cy={size * 0.9 - trunkH - canopyR * 0.5} rx={canopyR} ry={canopyR * 0.8}
              initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...T, delay: 0.2 }}
              fill={dead ? '#9ca3af' : '#7c3aed'} />
          )}
          {s > 0.5 && (
            <motion.ellipse cx={cx} cy={size * 0.9 - trunkH - canopyR * 0.7} rx={canopyR * 0.7} ry={canopyR * 0.5}
              initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...T, delay: 0.3 }}
              fill={dead ? '#6b7280' : '#6d28d9'} />
          )}
          {/* Stars/dots */}
          {s > 0.6 && !dead && Array.from({ length: 5 }, (_, i) => {
            const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
            const r = canopyR * 0.55;
            return (
              <motion.circle key={i} r={1.5}
                cx={cx + Math.cos(a) * r} cy={size * 0.9 - trunkH - canopyR * 0.5 + Math.sin(a) * r * 0.7}
                initial={{ opacity: 0 }} animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 2, delay: i * 0.4, repeat: Infinity }}
                fill="#fde68a" />
            );
          })}
        </>
      )}
    </svg>
  );
}

// ==================== REGISTRY ====================
export const TREE_SPECIES = [
  { key: 'cedar', name: 'Cedar', component: Cedar, unlock: 0, emoji: '🌲' },
  { key: 'bush', name: 'Bush', component: Bush, unlock: 0, emoji: '🌳' },
  { key: 'cherry', name: 'Cherry Blossom', component: CherryBlossom, unlock: 10, emoji: '🌸' },
  { key: 'sunflower', name: 'Sunflower', component: Sunflower, unlock: 25, emoji: '🌻' },
  { key: 'maple', name: 'Maple', component: Maple, unlock: 50, emoji: '🍁' },
  { key: 'baobab', name: 'Baobab', component: Baobab, unlock: 100, emoji: '🏝️' },
  { key: 'crystal', name: 'Crystal Tree', component: CrystalTree, unlock: -1, emoji: '💎' },
  { key: 'starry', name: 'Starry Tree', component: StarryTree, unlock: -1, emoji: '✨' },
] as const;

export type TreeSpeciesKey = typeof TREE_SPECIES[number]['key'];

export function TreeComponent({ species, ...props }: TreeProps & { species: string }) {
  const entry = TREE_SPECIES.find(t => t.key === species);
  if (!entry) return <Cedar {...props} />;
  const C = entry.component;
  return <C {...props} />;
}
