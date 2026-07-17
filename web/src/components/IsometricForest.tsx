import { useState, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TreePine, RotateCcw, ChevronDown, ChevronUp, Maximize2, Minimize2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { TreeComponent } from '@/components/trees';
import { cn } from '@/lib/utils';

type Session = {
  id: string;
  tree_species: string;
  actual_seconds: number;
  status: string;
  started_at: string;
  duration_seconds: number;
};

const GRID_SIZE = 16;
const GRID_COLS = 4;
const DEFAULT_ANGLE = -45;
const ISO_TILT = 55;

function formatDuration(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function IsometricForest({ sessions }: { sessions: Session[] }) {
  const [expanded, setExpanded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [angle, setAngle] = useState(DEFAULT_ANGLE);
  const [zoom, setZoom] = useState(1);

  // Drag state
  const dragging = useRef(false);
  const lastX = useRef(0);
  const velocity = useRef(0);
  const animFrame = useRef<number>(0);

  // Pinch state
  const lastPinchDist = useRef(0);

  // Split into patches
  const patches = useMemo(() => {
    const result: Session[][] = [];
    for (let i = 0; i < sessions.length; i += GRID_SIZE)
      result.push(sessions.slice(i, i + GRID_SIZE));
    return result;
  }, [sessions]);

  const totalPatches = patches.length;
  const currentPatch = patches[totalPatches - 1] ?? [];
  const pastPatches = patches.slice(0, -1);

  // Pointer drag handlers
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    lastX.current = e.clientX;
    velocity.current = 0;
    cancelAnimationFrame(animFrame.current);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastX.current;
    velocity.current = dx;
    lastX.current = e.clientX;
    setAngle(a => a + dx * 0.5);
  }, []);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
    // Momentum
    const decay = () => {
      if (Math.abs(velocity.current) < 0.3) return;
      velocity.current *= 0.92;
      setAngle(a => a + velocity.current * 0.5);
      animFrame.current = requestAnimationFrame(decay);
    };
    decay();
  }, []);

  // Wheel zoom
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => Math.min(2, Math.max(0.5, z - e.deltaY * 0.001)));
  }, []);

  // Touch pinch
  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (lastPinchDist.current > 0) {
        const delta = dist - lastPinchDist.current;
        setZoom(z => Math.min(2, Math.max(0.5, z + delta * 0.005)));
      }
      lastPinchDist.current = dist;
    }
  }, []);

  const onTouchEnd = useCallback(() => { lastPinchDist.current = 0; }, []);

  const resetView = useCallback(() => {
    setAngle(DEFAULT_ANGLE);
    setZoom(1);
  }, []);

  const containerClass = fullscreen
    ? 'fixed inset-0 z-50 bg-background flex flex-col'
    : '';

  return (
    <Card className={cn('overflow-hidden', fullscreen && 'rounded-none border-0 shadow-none')}>
      <div className={containerClass}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between w-full">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <TreePine className="h-4 w-4" /> My Forest
              </CardTitle>
              <CardDescription>
                {sessions.length} tree{sessions.length !== 1 ? 's' : ''} · {totalPatches} patch{totalPatches !== 1 ? 'es' : ''}
              </CardDescription>
            </div>
            <div className="flex items-center gap-1.5">
              <Badge variant="outline" className="text-xs">
                Patch {totalPatches} — {currentPatch.length}/{GRID_SIZE}
              </Badge>
              <button onClick={resetView} className="p-1.5 rounded-md hover:bg-accent text-muted-foreground" title="Reset view">
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => setFullscreen(f => !f)} className="p-1.5 rounded-md hover:bg-accent text-muted-foreground" title="Fullscreen">
                {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </button>
              <button onClick={() => setExpanded(e => !e)} className="p-1.5 rounded-md hover:bg-accent text-muted-foreground">
                {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent className={cn('p-4 pt-0', fullscreen && 'flex-1')}>
          {/* 3D Viewport */}
          <div
            className={cn(
              'relative overflow-hidden rounded-xl cursor-grab active:cursor-grabbing select-none',
              fullscreen ? 'h-full' : 'h-[340px] sm:h-[400px]',
            )}
            style={{ perspective: 1200 }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            onWheel={onWheel}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          >
            {/* Ambient background */}
            <div className="absolute inset-0 bg-gradient-to-b from-emerald-950/90 via-green-950/70 to-slate-950/90 dark:from-emerald-950 dark:via-green-950/80 dark:to-slate-950" />
            {/* Subtle light rays */}
            <div className="absolute inset-0 opacity-20" style={{
              background: 'radial-gradient(ellipse at 50% 20%, rgba(34,197,94,0.3) 0%, transparent 60%)',
            }} />

            {/* Scene container */}
            <motion.div
              className="absolute inset-0 flex items-center justify-center"
              style={{ transformStyle: 'preserve-3d' }}
              animate={{ scale: zoom }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            >
              {/* Isometric ground group */}
              <motion.div
                style={{
                  transformStyle: 'preserve-3d',
                  transform: `rotateX(${ISO_TILT}deg) rotateZ(${angle}deg)`,
                }}
              >
                {/* Current patch */}
                <GroundPatch trees={currentPatch} isCurrent angle={angle} />

                {/* Past patches — expanded */}
                <AnimatePresence>
                  {expanded && pastPatches.map((patch, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      transition={{ delay: idx * 0.06 }}
                      style={{
                        position: 'absolute',
                        left: ((idx % 3) - 1) * 260,
                        top: Math.floor(idx / 3) * 260 + 260,
                        transformStyle: 'preserve-3d',
                      }}
                    >
                      <GroundPatch trees={patch} angle={angle} label={`Patch ${idx + 1}`} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </motion.div>
            </motion.div>

            {/* Zoom indicator */}
            {zoom !== 1 && (
              <div className="absolute bottom-2 right-2 text-[10px] text-white/40 font-mono">
                {Math.round(zoom * 100)}%
              </div>
            )}
          </div>
        </CardContent>
      </div>
    </Card>
  );
}

// ==================== Ground Patch ====================
function GroundPatch({ trees, isCurrent, angle, label }: {
  trees: Session[];
  isCurrent?: boolean;
  angle: number;
  label?: string;
}) {
  const patchSize = isCurrent ? 240 : 200;
  const cellSize = patchSize / GRID_COLS;

  return (
    <div
      className="relative"
      style={{
        width: patchSize,
        height: patchSize,
        transformStyle: 'preserve-3d',
      }}
    >
      {/* Top face — grass */}
      <div
        className={cn(
          'absolute inset-0 rounded-lg',
          isCurrent
            ? 'shadow-[0_0_40px_rgba(34,197,94,0.2)]'
            : '',
        )}
        style={{
          background: isCurrent
            ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 40%, #15803d 70%, #166534 100%)'
            : 'linear-gradient(135deg, #16a34a 0%, #15803d 50%, #14532d 100%)',
          transform: 'translateZ(0px)',
          transformStyle: 'preserve-3d',
        }}
      >
        {/* Grass texture overlay */}
        <div className="absolute inset-0 rounded-lg opacity-30" style={{
          backgroundImage: `
            radial-gradient(circle at 20% 30%, rgba(255,255,255,0.15) 1px, transparent 1px),
            radial-gradient(circle at 60% 70%, rgba(255,255,255,0.1) 1px, transparent 1px),
            radial-gradient(circle at 80% 20%, rgba(255,255,255,0.12) 1px, transparent 1px),
            radial-gradient(circle at 40% 80%, rgba(255,255,255,0.08) 1px, transparent 1px)
          `,
          backgroundSize: '30px 30px, 25px 25px, 35px 35px, 20px 20px',
        }} />

        {/* Subtle grid lines */}
        <div className="absolute inset-0 rounded-lg opacity-10" style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.3) 1px, transparent 1px)',
          backgroundSize: `${100 / GRID_COLS}% ${100 / GRID_COLS}%`,
        }} />

        {/* Current patch glow ring */}
        {isCurrent && (
          <motion.div
            className="absolute inset-0 rounded-lg"
            animate={{ boxShadow: ['inset 0 0 20px rgba(34,197,94,0.3)', 'inset 0 0 30px rgba(34,197,94,0.15)', 'inset 0 0 20px rgba(34,197,94,0.3)'] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
      </div>

      {/* Left side face — earth */}
      <div
        className="absolute rounded-bl-lg"
        style={{
          width: patchSize,
          height: 20,
          bottom: 0,
          left: 0,
          background: 'linear-gradient(180deg, #78350f 0%, #451a03 100%)',
          transform: 'rotateX(-90deg) translateZ(0px)',
          transformOrigin: 'bottom center',
        }}
      />

      {/* Right side face — earth */}
      <div
        className="absolute rounded-br-lg"
        style={{
          width: 20,
          height: patchSize,
          top: 0,
          right: 0,
          background: 'linear-gradient(90deg, #92400e 0%, #451a03 100%)',
          transform: 'rotateY(90deg) translateZ(0px)',
          transformOrigin: 'right center',
        }}
      />

      {/* Trees */}
      {Array.from({ length: GRID_SIZE }, (_, i) => {
        const row = Math.floor(i / GRID_COLS);
        const col = i % GRID_COLS;
        const tree = trees[i];
        const treeSize = isCurrent ? 52 : 42;
        const x = col * cellSize + cellSize / 2;
        const y = row * cellSize + cellSize / 2;

        return (
          <div
            key={i}
            className="absolute"
            style={{
              left: x - treeSize / 2,
              top: y - treeSize / 2,
              width: treeSize,
              height: treeSize,
              transformStyle: 'preserve-3d',
              // Billboard: counter-rotate so trees face camera
              transform: `translateZ(10px) rotateZ(${-angle}deg) rotateX(${-ISO_TILT}deg)`,
            }}
          >
            {tree ? (
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: i * 0.04, type: 'spring', stiffness: 300, damping: 15 }}
                title={`${tree.tree_species} · ${formatDuration(tree.actual_seconds)} · ${new Date(tree.started_at).toLocaleDateString()}`}
              >
                {/* Tree shadow on ground */}
                <div
                  className="absolute bottom-0 left-1/2 -translate-x-1/2 rounded-full bg-black/20"
                  style={{
                    width: treeSize * 0.5,
                    height: treeSize * 0.15,
                    filter: 'blur(3px)',
                  }}
                />
                {/* Swaying tree wrapper */}
                <SwayingTree species={tree.tree_species} size={treeSize} index={i} />
              </motion.div>
            ) : (
              /* Empty slot indicator */
              <div className="w-full h-full flex items-center justify-center">
                <div
                  className="rounded-full border border-dashed border-white/15"
                  style={{ width: treeSize * 0.35, height: treeSize * 0.35 }}
                />
              </div>
            )}
          </div>
        );
      })}

      {/* Patch label */}
      {label && (
        <div
          className="absolute -bottom-6 left-1/2 text-[10px] text-white/50 font-medium whitespace-nowrap"
          style={{
            transform: `translateX(-50%) rotateZ(${-angle}deg) rotateX(${-ISO_TILT}deg)`,
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
}

// ==================== Swaying Tree Wrapper ====================
function SwayingTree({ species, size, index }: { species: string; size: number; index: number }) {
  // Each tree gets a unique sway phase and speed
  const duration = 2.5 + (index % 5) * 0.6;
  const delay = (index % 7) * 0.3;
  const swayAmount = 2 + (index % 3);

  return (
    <motion.div
      className="origin-bottom"
      animate={{
        rotate: [0, -swayAmount, 0, swayAmount, 0],
      }}
      transition={{
        duration,
        delay,
        repeat: Infinity,
        ease: 'easeInOut',
      }}
    >
      <TreeComponent species={species} stage={1} size={size} />
    </motion.div>
  );
}
