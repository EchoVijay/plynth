// Webcam monitor. Everything here runs inside the browser tab: the camera stream is attached to a
// local <video>, frames are analysed on-device by MediaPipe (WebAssembly, model files served from
// this site's own origin), and only booleans ("person seen", "phone seen") leave this hook.
// No frame, image or recording is ever stored or sent anywhere.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FaceDetector, ObjectDetector } from '@mediapipe/tasks-vision';

export type CameraStatus = 'off' | 'starting' | 'loading' | 'on' | 'denied' | 'nocamera' | 'error';

export interface MonitorSample {
  now: number;
  /** null when presence detection is disabled */
  personSeen: boolean | null;
  /** null when phone detection is disabled */
  phoneSeen: boolean | null;
}

interface Options {
  cameraOn: boolean;
  detectPresence: boolean;
  detectPhone: boolean;
  onSample?: (s: MonitorSample) => void;
}

const BASE = '/mediapipe';
const LOOP_MS = 500;
const PHONE_SCORE = 0.4;
const PERSON_SCORE = 0.5;

async function createDetectors(wantFace: boolean, wantObjects: boolean) {
  const { FilesetResolver, FaceDetector, ObjectDetector } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(`${BASE}/wasm`);

  const build = async <T,>(make: (delegate: 'GPU' | 'CPU') => Promise<T>): Promise<T> => {
    try { return await make('GPU'); } catch { return await make('CPU'); }
  };

  const face = wantFace
    ? await build((delegate) => FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${BASE}/models/blaze_face_short_range.tflite`, delegate },
        runningMode: 'VIDEO', minDetectionConfidence: 0.5,
      }))
    : null;
  const objects = wantObjects
    ? await build((delegate) => ObjectDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${BASE}/models/efficientdet_lite0.tflite`, delegate },
        runningMode: 'VIDEO', scoreThreshold: Math.min(PHONE_SCORE, PERSON_SCORE), maxResults: 6,
        categoryAllowlist: ['cell phone', 'person'],
      }))
    : null;
  return { face, objects };
}

export function useFocusMonitor({ cameraOn, detectPresence, detectPhone, onSample }: Options) {
  const [status, setStatus] = useState<CameraStatus>('off');
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [personSeen, setPersonSeen] = useState<boolean | null>(null);
  const [phoneSeen, setPhoneSeen] = useState<boolean | null>(null);

  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const onSampleRef = useRef(onSample);
  onSampleRef.current = onSample;

  const videoRef = useCallback((el: HTMLVideoElement | null) => {
    videoElRef.current = el;
    if (el) {
      if (el.srcObject !== streamRef.current) el.srcObject = streamRef.current;
      if (streamRef.current) void el.play().catch(() => undefined);
    }
  }, []);
  const streamRef = useRef<MediaStream | null>(null);

  const needDetection = detectPresence || detectPhone;

  // Camera lifecycle: open on demand, always release on cleanup.
  useEffect(() => {
    if (!cameraOn) { setStatus('off'); setError(null); return; }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('error'); setError('This browser does not support camera access.'); return;
    }
    let cancelled = false;
    let local: MediaStream | null = null;
    setStatus('starting'); setError(null);

    navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false })
      .then((s) => {
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        local = s;
        streamRef.current = s;
        setStream(s);
        s.getVideoTracks()[0]?.addEventListener('ended', () => {
          if (!cancelled) { setStatus('error'); setError('The camera was disconnected.'); }
        });
        const el = videoElRef.current;
        if (el) { el.srcObject = s; void el.play().catch(() => undefined); }
        setStatus('on');
      })
      .catch((e: DOMException) => {
        if (cancelled) return;
        if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') { setStatus('denied'); setError('Camera permission was blocked. Allow it in the address bar to use monitoring.'); }
        else if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') { setStatus('nocamera'); setError('No camera was found on this device.'); }
        else { setStatus('error'); setError(e?.message || 'Could not start the camera.'); }
      });

    return () => {
      cancelled = true;
      local?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoElRef.current) videoElRef.current.srcObject = null;
      setStream(null); setPersonSeen(null); setPhoneSeen(null);
    };
  }, [cameraOn]);

  // Detection loop: only while the camera is live and something needs analysing.
  useEffect(() => {
    if (!stream || !needDetection) { setPersonSeen(null); setPhoneSeen(null); return; }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let face: FaceDetector | null = null;
    let objects: ObjectDetector | null = null;
    let lastVideoTime = -1;
    let lastTs = 0;

    setStatus('loading');
    createDetectors(detectPresence, detectPhone || detectPresence)
      .then((d) => {
        if (cancelled) { d.face?.close(); d.objects?.close(); return; }
        face = d.face; objects = d.objects;
        setStatus('on');
        const tick = () => {
          if (cancelled) return;
          const video = videoElRef.current;
          if (video && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
            lastVideoTime = video.currentTime;
            const ts = Math.max(performance.now(), lastTs + 1);
            lastTs = ts;
            try {
              let person: boolean | null = null;
              let phone: boolean | null = null;
              if (face) person = face.detectForVideo(video, ts).detections.length > 0;
              if (objects) {
                const found = objects.detectForVideo(video, ts + 0.5).detections;
                const name = (x: (typeof found)[number]) => x.categories[0];
                if (detectPhone) phone = found.some((x) => name(x)?.categoryName === 'cell phone' && (name(x)?.score ?? 0) >= PHONE_SCORE);
                if (detectPresence) {
                  const bodySeen = found.some((x) => name(x)?.categoryName === 'person' && (name(x)?.score ?? 0) >= PERSON_SCORE);
                  person = (person ?? false) || bodySeen;
                }
              }
              if (!detectPresence) person = null;
              setPersonSeen(person); setPhoneSeen(phone);
              onSampleRef.current?.({ now: Date.now(), personSeen: person, phoneSeen: phone });
            } catch (e) {
              console.warn('[focus-monitor] detection failed', e);
            }
          }
          timer = setTimeout(tick, LOOP_MS);
        };
        tick();
      })
      .catch((e: Error) => {
        if (cancelled) return;
        console.warn('[focus-monitor] model load failed', e);
        setStatus('error');
        setError('Could not load the on-device detection models. The preview still works.');
      });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      try { face?.close(); } catch { /* already closed */ }
      try { objects?.close(); } catch { /* already closed */ }
    };
  }, [stream, needDetection, detectPresence, detectPhone]);

  return { status, error, stream, personSeen, phoneSeen, videoRef };
}
