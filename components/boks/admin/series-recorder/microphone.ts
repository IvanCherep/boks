"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The microphone for a reading: the browser's voice processing off - echo
 * cancellation, noise suppression and automatic gain are made for calls and
 * flatten a voice reading verse - and a level to see before recording.
 */

export type MicState = "off" | "asking" | "on" | "denied" | "unsupported";

export type MicLevel = { rms: number; peak: number };

const constraints = (deviceId?: string): MediaStreamConstraints => ({
  audio: {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
  },
});

/** What the recorder makes here: Chrome and Firefox WebM/Opus, Safari MP4/AAC. */
export function recordingType() {
  if (typeof MediaRecorder === "undefined") return null;
  return ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

const toDb = (value: number) => (value > 0 ? 20 * Math.log10(value) : -100);

export function useMicrophone() {
  const [state, setState] = useState<MicState>(() =>
    typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function" && recordingType() !== null ? "off" : "unsupported",
  );
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [level, setLevel] = useState<MicLevel>({ rms: -100, peak: -100 });
  const streamRef = useRef<MediaStream | null>(null);

  const open = useCallback(async (id?: string) => {
    setState("asking");
    try {
      const next = await navigator.mediaDevices.getUserMedia(constraints(id || undefined));
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = next;
      setStream(next);
      setState("on");
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((device) => device.kind === "audioinput" && device.deviceId));
      setDeviceId(next.getAudioTracks()[0]?.getSettings().deviceId ?? id ?? "");
    } catch {
      setState("denied");
    }
  }, []);

  const choose = useCallback((id: string) => {
    setDeviceId(id);
    void open(id);
  }, [open]);

  // The level, a few times a second: loudest sample and average power over the last moment.
  useEffect(() => {
    if (!stream) return;
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let frame = 0;
    let last = 0;
    let held = -100;
    const tick = (time: number) => {
      frame = requestAnimationFrame(tick);
      if (time - last < 80) return;
      last = time;
      analyser.getFloatTimeDomainData(samples);
      let peak = 0;
      let sum = 0;
      for (const sample of samples) {
        peak = Math.max(peak, Math.abs(sample));
        sum += sample * sample;
      }
      // A peak is held a moment, so a clip is seen rather than flickered.
      held = Math.max(toDb(peak), held - 3);
      setLevel({ rms: toDb(Math.sqrt(sum / samples.length)), peak: held });
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      void context.close();
    };
  }, [stream]);

  useEffect(() => () => streamRef.current?.getTracks().forEach((track) => track.stop()), []);

  return { state, stream, devices, deviceId, level, open, choose };
}

/** How the level reads to a person: silent, too quiet, good, too loud. */
export function levelVerdict(level: MicLevel): "silent" | "quiet" | "good" | "loud" {
  if (level.peak > -1.5) return "loud";
  if (level.rms < -58) return "silent";
  if (level.peak < -24) return "quiet";
  return "good";
}

/** A take: chunks every second, so a stop at any moment keeps everything said. */
export function startRecording(stream: MediaStream) {
  const type = recordingType() ?? "";
  const recorder = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 128_000 });
  const chunks: Blob[] = [];
  const started = performance.now();
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  recorder.start(1000);
  return {
    elapsed: () => performance.now() - started,
    stop: () =>
      new Promise<{ blob: Blob; durationMs: number }>((resolve) => {
        const durationMs = performance.now() - started;
        recorder.onstop = () => resolve({ blob: new Blob(chunks, { type: recorder.mimeType || type || "audio/webm" }), durationMs });
        recorder.stop();
      }),
    cancel: () => {
      recorder.onstop = null;
      if (recorder.state !== "inactive") recorder.stop();
    },
  };
}
