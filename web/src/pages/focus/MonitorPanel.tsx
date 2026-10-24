import { Camera, CameraOff, Eye, EyeOff, Loader2, ShieldCheck, Smartphone, Trash2, UserCheck, UserX, Volume2 } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Switch } from '@/components/ui/Switch';
import { cn } from '@/lib/utils';
import type { CameraStatus } from '@/lib/focus/useFocusMonitor';
import { summarizeLog, type MonitorLogEntry, type MonitorPrefs } from '@/lib/focus/local-store';
import { HowItWorks } from './HowItWorks';

interface Props {
  prefs: MonitorPrefs;
  onPrefs: (p: MonitorPrefs) => void;
  status: CameraStatus;
  error: string | null;
  videoRef: (el: HTMLVideoElement | null) => void;
  cameraLive: boolean;
  sessionActive: boolean;
  away: boolean;
  personSeen: boolean | null;
  phoneSeen: boolean | null;
  warnings: number;
  maxWarnings: number;
  testing: boolean;
  onToggleTest: () => void;
  log: MonitorLogEntry[];
  onClearLog: () => void;
}

function Row({ icon, title, hint, checked, disabled, onChange }: {
  icon: React.ReactNode; title: string; hint: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-3 py-2', disabled && 'opacity-50')}>
      <div className="flex items-start gap-2.5 min-w-0">
        <span className="mt-0.5 text-muted-foreground">{icon}</span>
        <div className="min-w-0">
          <p className="text-sm font-medium leading-tight">{title}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={title} />
    </div>
  );
}

const STATUS_TEXT: Record<CameraStatus, string> = {
  off: 'Camera off', starting: 'Starting camera…', loading: 'Loading on-device models…', on: 'Camera on',
  denied: 'Camera blocked', nocamera: 'No camera found', error: 'Camera problem',
};

export function MonitorPanel(p: Props) {
  const set = (patch: Partial<MonitorPrefs>) => p.onPrefs({ ...p.prefs, ...patch });
  const on = p.prefs.monitor;
  const busy = p.status === 'starting' || p.status === 'loading';
  const showPreview = on && p.prefs.preview && p.cameraLive;
  const totals = summarizeLog(p.log);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Camera className="h-4 w-4 text-primary" /> Monitor
          </CardTitle>
          <HowItWorks />
        </div>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <Badge variant="success" className="gap-1 whitespace-nowrap font-normal"><ShieldCheck className="h-3 w-3" /> Stays in this browser</Badge>
          Optional webcam focus check. Nothing is uploaded or saved to the cloud.
        </p>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="divide-y">
          <Row icon={<Camera className="h-4 w-4" />} title="Monitor my focus" hint="Use the webcam during sessions" checked={on} onChange={(v) => set({ monitor: v })} />
          <Row icon={p.prefs.preview ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />} title="Camera preview" hint="Show or hide the live picture (checks keep running)" checked={p.prefs.preview} disabled={!on} onChange={(v) => set({ preview: v })} />
          <Row icon={<UserCheck className="h-4 w-4" />} title="Pause when I leave" hint="Auto-pause if you step away, resume when back" checked={p.prefs.presence} disabled={!on} onChange={(v) => set({ presence: v })} />
          <Row icon={<Smartphone className="h-4 w-4" />} title="Detect phone use" hint={`${p.maxWarnings} warnings, then +10 min penalty and a stop`} checked={p.prefs.phone} disabled={!on} onChange={(v) => set({ phone: v })} />
          <Row icon={<Volume2 className="h-4 w-4" />} title="Alert sounds" hint="Beep on warnings and pauses" checked={p.prefs.sound} disabled={!on} onChange={(v) => set({ sound: v })} />
        </div>

        {on && (
          <div className="space-y-3">
            <div className={cn(
              'relative overflow-hidden rounded-xl border bg-muted/40',
              showPreview ? 'aspect-video' : 'h-14',
            )}>
              {/* Always mounted: detection reads frames from this element even when the preview is hidden. */}
              <video
                ref={p.videoRef} muted playsInline autoPlay
                className={cn(
                  '-scale-x-100 object-cover',
                  showPreview ? 'h-full w-full' : 'pointer-events-none absolute h-px w-px opacity-0',
                )}
              />
              {showPreview && p.sessionActive && p.phoneSeen && (
                <div className="absolute inset-x-0 top-0 bg-amber-500/90 text-white text-xs font-medium px-3 py-1 flex items-center gap-1.5">
                  <Smartphone className="h-3.5 w-3.5" /> Phone detected
                </div>
              )}
              {!showPreview && (
                <div className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : p.cameraLive ? <EyeOff className="h-4 w-4" /> : <CameraOff className="h-4 w-4" />}
                  {p.cameraLive && !p.prefs.preview ? 'Preview hidden · camera is checking in the background' : STATUS_TEXT[p.status]}
                </div>
              )}
              {showPreview && (
                <div className="absolute bottom-2 left-2 flex gap-1.5">
                  <Badge variant="secondary" className="bg-black/60 text-white gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" /> Live · on this device only
                  </Badge>
                </div>
              )}
            </div>

            {p.error && <p className="text-xs text-destructive">{p.error}</p>}

            <div className="flex flex-wrap items-center gap-2">
              {p.cameraLive && p.prefs.presence && p.personSeen !== null && (
                <Badge variant={p.away ? 'warning' : 'success'} className="gap-1">
                  {p.away ? <UserX className="h-3 w-3" /> : <UserCheck className="h-3 w-3" />}
                  {p.away ? 'Away' : p.personSeen ? 'You are here' : 'Looking for you…'}
                </Badge>
              )}
              {p.prefs.phone && (
                <span className="flex items-center gap-1" title={`${p.warnings} of ${p.maxWarnings} phone warnings`}>
                  <Smartphone className="h-3.5 w-3.5 text-muted-foreground" />
                  {Array.from({ length: p.maxWarnings }, (_, i) => (
                    <span key={i} className={cn('h-2.5 w-2.5 rounded-full border', i < p.warnings ? 'bg-amber-500 border-amber-500' : 'border-muted-foreground/40')} />
                  ))}
                </span>
              )}
              {!p.sessionActive && (
                <Button size="sm" variant="outline" className="ml-auto gap-1.5" onClick={p.onToggleTest}>
                  {p.testing ? <><CameraOff className="h-3.5 w-3.5" /> Stop test</> : <><Camera className="h-3.5 w-3.5" /> Test camera</>}
                </Button>
              )}
            </div>
          </div>
        )}

        {p.log.length > 0 && (
          <div className="flex items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
            <span>
              This device: {totals.sessions} monitored session{totals.sessions === 1 ? '' : 's'} · {Math.round(totals.awaySeconds / 60)} min away · {totals.phoneWarnings} phone warning{totals.phoneWarnings === 1 ? '' : 's'}
              {totals.penalties > 0 && ` · ${totals.penalties} penalt${totals.penalties === 1 ? 'y' : 'ies'}`}
            </span>
            <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={p.onClearLog}>
              <Trash2 className="h-3 w-3" /> Clear monitor history
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
