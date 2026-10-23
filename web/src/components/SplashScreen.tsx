import { motion } from 'framer-motion';

const LETTERS = 'PLYNTH'.split('');

export function SplashScreen({ onDone }: { onDone: () => void }) {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0b1020] overflow-hidden"
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
    >
      {/* Ambient glow behind logo */}
      <motion.div
        className="absolute w-48 h-48 rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.4) 0%, transparent 70%)' }}
        animate={{ scale: [1, 1.4, 1], opacity: [0.5, 0.8, 0.5] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Sparkle particles */}
      {Array.from({ length: 8 }).map((_, i) => (
        <motion.span
          key={i}
          className="splash-particle"
          style={{
            '--angle': `${i * 45}deg`,
            '--delay': `${1.8 + i * 0.08}s`,
          } as React.CSSProperties}
        />
      ))}

      {/* 3D Logo */}
      <motion.div
        className="relative"
        style={{ perspective: 1000 }}
        initial={{ scale: 0, rotateY: 0 }}
        animate={{ scale: 1, rotateY: 360 }}
        transition={{
          scale: { type: 'spring', stiffness: 200, damping: 15, delay: 0.2 },
          rotateY: { duration: 1.2, ease: [0.22, 1, 0.36, 1] },
        }}
      >
        <div style={{ transformStyle: 'preserve-3d' }}>
          <motion.img
            src="/logo.png"
            alt="Plynth"
            width={112}
            height={112}
            className="h-28 w-28 drop-shadow-2xl"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
          />
        </div>
      </motion.div>

      {/* Brand name — staggered letter reveal */}
      <div className="flex gap-1 mt-6">
        {LETTERS.map((letter, i) => (
          <motion.span
            key={i}
            className="text-3xl font-bold tracking-widest text-white"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.3 + i * 0.1, duration: 0.3, ease: 'easeOut' }}
          >
            {letter}
          </motion.span>
        ))}
      </div>

      {/* Tagline */}
      <motion.p
        className="text-sm text-indigo-300/80 mt-2 tracking-wide"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 2.0, duration: 0.5 }}
      />

      {/* Final exit trigger */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2.8 }}
        onAnimationComplete={onDone}
      />
    </motion.div>
  );
}
