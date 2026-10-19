"use client";

/**
 * A gain stage is created only when a reader moves a Sound slider. This keeps
 * ordinary first-tap playback on the media element and lets mobile browsers
 * whose media volume is device-controlled still mix voice and music.
 */
export function createMediaLevel(element: HTMLAudioElement) {
  let context: AudioContext | null = null;
  let source: MediaElementAudioSourceNode | null = null;
  let gain: GainNode | null = null;
  let level = element.volume;
  const reportFailure = () => { element.pause(); element.dispatchEvent(new Event("boks-mixer-error")); };

  return {
    set(value: number, activate = false) {
      level = Math.max(0, Math.min(1, value));
      if (activate && !context && typeof window !== "undefined") {
        const AudioContextClass = window.AudioContext
          ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioContextClass) {
          try {
            context = new AudioContextClass();
            source = context.createMediaElementSource(element);
            gain = context.createGain();
            source.connect(gain);
            gain.connect(context.destination);
            element.volume = 1;
            void context.resume().catch(reportFailure);
          } catch {
            source?.disconnect();
            void context?.close().catch(() => {});
            context = null;
            source = null;
            gain = null;
          }
        }
      }
      if (gain) gain.gain.value = level;
      else element.volume = level;
    },
    resume() { if (context?.state === "suspended") void context.resume().catch(reportFailure); },
    dispose() {
      source?.disconnect();
      gain?.disconnect();
      void context?.close().catch(() => {});
    },
  };
}
