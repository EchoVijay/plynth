// period-utils.ts — Cycle prediction, phase calculation, and motivational quotes.

export interface Cycle {
  id: string;
  start_date: string; // YYYY-MM-DD
  end_date: string | null;
  cycle_length: number | null;
}

export type Phase = 'menstrual' | 'follicular' | 'ovulatory' | 'luteal';
export type Regularity = 'very_regular' | 'regular' | 'irregular' | 'very_irregular';

export interface PhaseInfo {
  phase: Phase;
  dayInPhase: number;
  dayInCycle: number;
  totalPhaseDays: number;
  color: string;
  gradient: string;
  emoji: string;
  label: string;
}

export interface Prediction {
  nextPeriodStart: string;
  nextPeriodEnd: string;
  fertileStart: string;
  fertileEnd: string;
  ovulationDay: string;
  avgCycleLength: number;
  avgPeriodLength: number;
  confidence: number;
  regularity: Regularity;
  daysUntilPeriod: number;
}

const PHASE_CONFIG: Record<Phase, { color: string; gradient: string; emoji: string; label: string }> = {
  menstrual: { color: '#f43f5e', gradient: 'from-rose-500 to-red-400', emoji: '🌺', label: 'Menstrual Phase' },
  follicular: { color: '#10b981', gradient: 'from-emerald-400 to-teal-400', emoji: '🌱', label: 'Follicular Phase' },
  ovulatory: { color: '#f59e0b', gradient: 'from-amber-400 to-orange-400', emoji: '✨', label: 'Ovulatory Phase' },
  luteal: { color: '#8b5cf6', gradient: 'from-violet-400 to-purple-500', emoji: '🌙', label: 'Luteal Phase' },
};

// ---- Core Calculations ----

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

function addDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Get full cycle lengths (time between consecutive period starts) */
export function getFullCycleLengths(cycles: Cycle[]): number[] {
  const sorted = [...cycles].sort((a, b) => a.start_date.localeCompare(b.start_date));
  const lengths: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const len = daysBetween(sorted[i - 1].start_date, sorted[i].start_date);
    if (len > 15 && len < 60) lengths.push(len); // reasonable range
  }
  return lengths;
}

/** Average period length (how many days of bleeding) */
export function getAvgPeriodLength(cycles: Cycle[]): number {
  const withEnd = cycles.filter(c => c.end_date);
  if (!withEnd.length) return 5;
  const total = withEnd.reduce((sum, c) => sum + daysBetween(c.start_date, c.end_date!) + 1, 0);
  return Math.round(total / withEnd.length);
}

/** Calculate cycle regularity based on standard deviation */
export function getCycleRegularity(cycles: Cycle[]): Regularity {
  const lengths = getFullCycleLengths(cycles);
  if (lengths.length < 2) return 'regular';
  const avg = lengths.reduce((s, l) => s + l, 0) / lengths.length;
  const variance = lengths.reduce((s, l) => s + (l - avg) ** 2, 0) / lengths.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev <= 3) return 'very_regular';
  if (stdDev <= 7) return 'regular';
  if (stdDev <= 14) return 'irregular';
  return 'very_irregular';
}

/** Predict next cycle based on historical data */
export function predictNextPeriod(cycles: Cycle[]): Prediction | null {
  if (!cycles.length) return null;
  const sorted = [...cycles].sort((a, b) => b.start_date.localeCompare(a.start_date));
  const lastCycle = sorted[0];

  const lengths = getFullCycleLengths(cycles);
  const recentLengths = lengths.slice(-6); // last 6
  const avgCycleLength = recentLengths.length > 0
    ? Math.round(recentLengths.reduce((s, l) => s + l, 0) / recentLengths.length)
    : 28;
  const avgPeriodLength = getAvgPeriodLength(cycles);
  const regularity = getCycleRegularity(cycles);

  const nextStart = addDays(lastCycle.start_date, avgCycleLength);
  const nextEnd = addDays(nextStart, avgPeriodLength - 1);
  const daysUntil = daysBetween(today(), nextStart);

  // Fertile window: typically days 10-16 of cycle (counting from next predicted start)
  const ovulationDayNum = Math.round(avgCycleLength - 14); // 14 days before next period
  const ovulationDay = addDays(lastCycle.start_date, ovulationDayNum);
  const fertileStart = addDays(ovulationDay, -4);
  const fertileEnd = addDays(ovulationDay, 1);

  // Confidence: based on data points and regularity
  const dataFactor = Math.min(recentLengths.length / 6, 1);
  const regFactor = regularity === 'very_regular' ? 1 : regularity === 'regular' ? 0.7 : regularity === 'irregular' ? 0.4 : 0.2;
  const confidence = Math.round((0.3 + 0.5 * dataFactor + 0.2 * regFactor) * 100);

  return {
    nextPeriodStart: nextStart,
    nextPeriodEnd: nextEnd,
    fertileStart,
    fertileEnd,
    ovulationDay,
    avgCycleLength,
    avgPeriodLength,
    confidence,
    regularity,
    daysUntilPeriod: daysUntil,
  };
}

/** Get current phase based on last cycle start */
export function getCurrentPhase(lastCycleStart: string, avgCycleLength: number = 28): PhaseInfo {
  const dayInCycle = daysBetween(lastCycleStart, today()) + 1;
  const periodLen = 5;
  const ovulationDay = Math.round(avgCycleLength - 14);

  let phase: Phase;
  let dayInPhase: number;
  let totalPhaseDays: number;

  if (dayInCycle <= periodLen) {
    phase = 'menstrual';
    dayInPhase = dayInCycle;
    totalPhaseDays = periodLen;
  } else if (dayInCycle <= ovulationDay - 2) {
    phase = 'follicular';
    dayInPhase = dayInCycle - periodLen;
    totalPhaseDays = ovulationDay - 2 - periodLen;
  } else if (dayInCycle <= ovulationDay + 1) {
    phase = 'ovulatory';
    dayInPhase = dayInCycle - (ovulationDay - 2);
    totalPhaseDays = 3;
  } else {
    phase = 'luteal';
    dayInPhase = dayInCycle - (ovulationDay + 1);
    totalPhaseDays = avgCycleLength - (ovulationDay + 1);
  }

  return {
    phase,
    dayInPhase,
    dayInCycle,
    totalPhaseDays: Math.max(totalPhaseDays, 1),
    ...PHASE_CONFIG[phase],
  };
}

// ---- Motivational Quotes ----

const QUOTES: Record<Phase, string[]> = {
  menstrual: [
    "Rest is productive. Your body is doing incredible work right now. 🌸",
    "Be gentle with yourself — you deserve all the comfort today. 💕",
    "This is your time to slow down and recharge. You've earned it. 🫖",
    "Honor your body's rhythm. Rest now, bloom later. 🌺",
    "You're stronger than you think, even on the hardest days. 💪🌹",
    "Wrap yourself in warmth and kindness today. You matter. 🧸",
  ],
  follicular: [
    "Fresh energy is flowing — you're ready to take on anything! 🌱✨",
    "This is your superpower phase. Dream big, start new things! 🚀",
    "Your creativity is peaking. The world is yours to shape. 🎨",
    "You're blooming beautifully. Embrace this fresh start! 🌷",
    "Channel this rising energy into something that lights you up. ⚡",
    "New ideas, new beginnings. You're unstoppable right now. 💫",
  ],
  ovulatory: [
    "You're glowing! Your confidence is magnetic today. ✨👑",
    "This is your moment to shine. Speak up, show up, stand out! 🌟",
    "Your energy is contagious — spread that sunshine! ☀️",
    "You're at your social peak. Connect, create, celebrate! 🎉",
    "Radiance comes from within — and you're overflowing with it. 💎",
    "The universe conspires in your favor today. Go get it! 🔥",
  ],
  luteal: [
    "Slow and steady wins the race. Be patient with yourself. 🌙",
    "It's okay to need extra comfort. Treat yourself gently. 💜",
    "Your intuition is powerful right now. Trust your inner voice. 🔮",
    "Nesting mode activated — cozy vibes only. 🕯️",
    "You're doing amazing. Even the moon takes time to be full again. 🌛",
    "Self-care isn't selfish. Give yourself what you need today. 🫂",
  ],
};

export function getPhaseQuote(phase: Phase): string {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
  const quotes = QUOTES[phase];
  return quotes[dayOfYear % quotes.length];
}

// ---- Helpers for calendar/display ----

export function isDateInRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

export function getPhaseForDate(date: string, lastCycleStart: string, avgCycleLength: number): Phase {
  const dayInCycle = daysBetween(lastCycleStart, date) + 1;
  if (dayInCycle < 1 || dayInCycle > avgCycleLength) return 'luteal';
  const periodLen = 5;
  const ovulationDay = Math.round(avgCycleLength - 14);
  if (dayInCycle <= periodLen) return 'menstrual';
  if (dayInCycle <= ovulationDay - 2) return 'follicular';
  if (dayInCycle <= ovulationDay + 1) return 'ovulatory';
  return 'luteal';
}

export { PHASE_CONFIG, addDays, daysBetween };
