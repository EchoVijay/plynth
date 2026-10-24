// Everything the webcam monitor produces lives ONLY in this browser (localStorage). Nothing in this
// file talks to the network. Frames are never stored at all; only on/off preferences and small
// per-session counters (times away, phone warnings) are kept, and the user can wipe them.

export interface MonitorPrefs {
  monitor: boolean;     // master switch: use the webcam during sessions
  preview: boolean;     // show the camera preview
  presence: boolean;    // pause when the user leaves
  phone: boolean;       // warn / penalise phone use
  sound: boolean;       // beep on warnings
  strictTab: boolean;   // leaving this tab for >10 s withers the plant
}

export const DEFAULT_PREFS: MonitorPrefs = {
  monitor: false, preview: true, presence: true, phone: true, sound: true, strictTab: false,
};

export interface MonitorLogEntry {
  id: string;
  at: string;               // ISO start time
  task: string;
  plannedSeconds: number;
  awayCount: number;
  awaySeconds: number;
  phoneWarnings: number;
  penalties: number;
  penaltySeconds: number;
  outcome: 'completed' | 'abandoned';
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const PREFS_KEY = 'plynth.focus.monitor.prefs.v1';
const LOG_KEY = 'plynth.focus.monitor.log.v1';
const LOG_CAP = 100;

function safeStore(): Store | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export function loadPrefs(store: Store | null = safeStore()): MonitorPrefs {
  try {
    const raw = store?.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<MonitorPrefs>;
    const out = { ...DEFAULT_PREFS };
    for (const k of Object.keys(DEFAULT_PREFS) as (keyof MonitorPrefs)[]) {
      if (typeof parsed[k] === 'boolean') out[k] = parsed[k] as boolean;
    }
    return out;
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: MonitorPrefs, store: Store | null = safeStore()): void {
  try { store?.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage full or blocked */ }
}

export function loadLog(store: Store | null = safeStore()): MonitorLogEntry[] {
  try {
    const raw = store?.getItem(LOG_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as MonitorLogEntry[]) : [];
  } catch {
    return [];
  }
}

export function appendLog(entry: MonitorLogEntry, store: Store | null = safeStore()): MonitorLogEntry[] {
  const next = [entry, ...loadLog(store)].slice(0, LOG_CAP);
  try { store?.setItem(LOG_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}

export function clearLog(store: Store | null = safeStore()): void {
  try { store?.removeItem(LOG_KEY); } catch { /* ignore */ }
}

export function summarizeLog(entries: MonitorLogEntry[]) {
  return entries.reduce(
    (a, e) => ({
      sessions: a.sessions + 1,
      awaySeconds: a.awaySeconds + e.awaySeconds,
      phoneWarnings: a.phoneWarnings + e.phoneWarnings,
      penalties: a.penalties + e.penalties,
    }),
    { sessions: 0, awaySeconds: 0, phoneWarnings: 0, penalties: 0 },
  );
}
