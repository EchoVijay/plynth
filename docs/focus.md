# Focus

Plan work, run a timer, grow plants. Optional webcam monitoring keeps you honest.

## Planner

A focus task is a normal row in `tasks` with `estimated_minutes` (and `focused_seconds`, the time spent so far).
Tasks created here get today's due date, so they also show up in To-Do, the Calendar overview and Chat's
`get_schedule`. Starting a task creates a `focus_sessions` row (with `task_id` and `task_title`); finishing it adds the
session time to `tasks.focused_seconds`, and a completed session that reaches the estimate marks the task done.

## Plants

`web/src/components/trees/` holds the plant system: `TreeComponent` (one plant, continuous growth `stage` 0..1),
`PlantScene` (the live diorama for the running session) and `Meadow` (today's garden). Species unlock by the number
of completed sessions (see `species.ts`). The DB keeps only the species key in `focus_sessions.tree_species`.

## Monitor (webcam), entirely on-device

Opt-in, off by default, each part has its own switch: monitor, preview, pause-when-away, phone detection, sounds.

| Piece | File |
|---|---|
| Camera + MediaPipe loop (emits only booleans) | `web/src/lib/focus/useFocusMonitor.ts` |
| Away / back logic (6 s grace, 1.5 s to return) | `web/src/lib/focus/presence.ts` |
| 3 warnings, then +10 min penalty and a stop | `web/src/lib/focus/phone-guard.ts` |
| Timestamp clock (pause, resume, penalty) | `web/src/lib/focus/session-clock.ts` |
| Preferences and per-session counters | `web/src/lib/focus/local-store.ts` (localStorage only) |

**Privacy contract:** no frame, image or recording is stored or sent anywhere. The detection models and WebAssembly runtime
are served from this site (`web/public/mediapipe/`, MediaPipe Tasks Vision 0.10.21, Apache-2.0), so no third party sees the
camera. Warnings/away time/penalties are kept only in the browser's localStorage and can be cleared in the UI. There are
deliberately no database columns for them. Do not add any.

Netlify must send `Permissions-Policy: camera=(self)` (see `netlify.toml`); `camera=()` blocks the webcam entirely.

Detection limits: it is a nudge, not a judge. Phone detection needs the phone to be visible to the camera, and
the tab should stay visible because browsers throttle hidden tabs.
