import { storage } from '../storage';

export const AUDIO_PROFILES = {
  flat: { low:0, mid:0, high:0 },
  warm: { low:2, mid:0, high:-1 },
  bass: { low:5, mid:-1, high:-1 },
  vocal: { low:-1, mid:3, high:1 },
  bright: { low:-1, mid:0, high:4 },
} as const;

export type AudioProfile = keyof typeof AUDIO_PROFILES;
const NATIVE_PROFILE: Record<AudioProfile,number> = {flat:1,warm:2,bass:3,vocal:4,bright:5};
/** Closed native effect enum; bit 3 enables real level telemetry. */
export function nativeDspMode(profile: AudioProfile, enabled: boolean, meter: boolean): number {
  return (enabled ? NATIVE_PROFILE[profile] : 0) + (meter ? 8 : 0);
}
const KEY = 'tsugi-audio-profile-v1';

export function isAudioProfile(value: unknown): value is AudioProfile {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(AUDIO_PROFILES,value);
}

export function readAudioProfile(): AudioProfile {
  const saved = storage.get<unknown>(KEY);
  return isAudioProfile(saved) ? saved : 'flat';
}

export function saveAudioProfile(profile: AudioProfile): void {
  if (isAudioProfile(profile)) storage.set(KEY,profile);
}

export type BrowserAudioGraph = {
  context: AudioContext;
  element: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  analyser: AnalyserNode;
  filters: [BiquadFilterNode, BiquadFilterNode, BiquadFilterNode];
};

/** The caller admits only local files or successfully loaded CORS media.
 * Never attach an opaque remote element: Web Audio would silence its output. */
export function createBrowserAudioGraph(element: HTMLAudioElement): BrowserAudioGraph {
  const context = new AudioContext();
  try {
    const low = context.createBiquadFilter();
    low.type = 'lowshelf'; low.frequency.value = 140;
    const mid = context.createBiquadFilter();
    mid.type = 'peaking'; mid.frequency.value = 1100; mid.Q.value = 0.8;
    const high = context.createBiquadFilter();
    high.type = 'highshelf'; high.frequency.value = 6500;
    low.connect(mid);
    mid.connect(high);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = .82;
    high.connect(analyser);
    analyser.connect(context.destination);
    // Configure the downstream graph before taking ownership of media output.
    const source = context.createMediaElementSource(element);
    source.connect(low);
    return { context, element, source, analyser, filters:[low,mid,high] };
  } catch (reason) {
    void context.close().catch(() => {});
    throw reason;
  }
}

export function setBrowserEqualizer(
  graph: BrowserAudioGraph, profile: AudioProfile, enabled: boolean
): void {
  const gains = enabled ? AUDIO_PROFILES[profile] : AUDIO_PROFILES.flat;
  const now = graph.context.currentTime;
  for (const [index,value] of [gains.low,gains.mid,gains.high].entries()) {
    graph.filters[index].gain.setTargetAtTime(value,now,0.04);
  }
}
