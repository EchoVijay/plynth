import { HelpCircle, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/Dialog';
import { DEFAULT_PHONE_GUARD } from '@/lib/focus/phone-guard';
import { DEFAULT_PRESENCE } from '@/lib/focus/presence';

const penaltyMin = DEFAULT_PHONE_GUARD.penaltySeconds / 60;
const awaySec = DEFAULT_PRESENCE.awayAfterMs / 1000;

export function HowItWorks() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 whitespace-nowrap text-muted-foreground">
          <HelpCircle className="h-4 w-4" /> How it works
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>How Focus works</DialogTitle>
          <DialogDescription>Plan a task, start the timer, and grow a plant while you stay on it.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 text-sm">
          <section className="space-y-1.5">
            <h3 className="font-semibold">1 · Plan and grow</h3>
            <p className="text-muted-foreground">
              Add a task with a time (for example <em>Learn Python – 1 h</em>) and press Start. A plant grows as the
              timer runs. Finish the session and it joins your garden; give up and it withers. New plant species unlock as you
              complete more sessions.
            </p>
          </section>

          <section className="space-y-1.5">
            <h3 className="font-semibold">2 · Monitor (optional, off by default)</h3>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li><b className="text-foreground">Presence:</b> if nobody is in front of the camera for {awaySec} seconds the timer pauses automatically, and resumes when you are back. If you paused it yourself it stays paused.</li>
              <li><b className="text-foreground">Phone detection:</b> if a phone is seen in front of the camera you get a warning (up to {DEFAULT_PHONE_GUARD.maxWarnings}). If it happens again after the {DEFAULT_PHONE_GUARD.maxWarnings}rd warning, {penaltyMin} minutes are added to the timer as a penalty and the timer stops until you press Resume.</li>
              <li><b className="text-foreground">Preview, presence, phone detection and sound</b> each have their own switch. Turn any of them off and that check simply stops.</li>
              <li>Put the camera where it can see you and your desk. Keep this tab visible (for example side by side) because browsers slow down hidden tabs.</li>
              <li>Detection is automatic and can be wrong (a dark room, a phone held below the frame, a pen mistaken for a phone). Treat it as a nudge, not a judge.</li>
            </ul>
          </section>

          <section className="space-y-2 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3">
            <h3 className="font-semibold flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-emerald-600" /> Privacy policy for the camera</h3>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li><b className="text-foreground">Everything stays in your browser.</b> Video is analysed on your device. No image, video, audio or recording is uploaded, stored in the cloud, or sent to any server, including ours.</li>
              <li>The detection models run locally (WebAssembly) and are served from this site, so no third party sees your camera either.</li>
              <li>Frames are analysed live and immediately discarded. Nothing is saved, not even to your disk.</li>
              <li>The only things kept are your on/off settings and small counters per session (times away, phone warnings, penalties). They live in this browser's local storage, are never synced to the cloud, and can be erased with <em>Clear monitor history</em>.</li>
              <li>The camera light turns on only while a monitored session (or a camera test) is active and is released when it ends. You can switch monitoring off at any time.</li>
              <li>Your browser asks for camera permission first. You can revoke it from the address bar whenever you like.</li>
            </ul>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
