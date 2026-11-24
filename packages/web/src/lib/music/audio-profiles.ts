import { storage } from '../storage';

export const AUDIO_PROFILES = {
  flat: { low:0, mid:0, high:0 },
  warm: { low:2, mid:0, high:-1 },
  bass: { low:5, mid:-1, high:-1 },
  vocal: { low:-1, mid:3, high:1 },
  bright: { low:-1, mid:0, high:4 },
} as const;

export type AudioProfile = keyof typeof AUDIO_PROFILES;
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

export type LocalEqualizer = {
  context: AudioContext;
  element: HTMLAudioElement;
  filters: [BiquadFilterNode, BiquadFilterNode, BiquadFilterNode];
};

/** Only connect explicitly selected local Blob media; remote CORS may be opaque/silent. */
export function createLocalEqualizer(element: HTMLAudioElement): LocalEqualizer {
  const context = new AudioContext();
  try {
    const source = context.createMediaElementSource(element);
    const low = context.createBiquadFilter();
    low.type = 'lowshelf'; low.frequency.value = 140;
    const mid = context.createBiquadFilter();
    mid.type = 'peaking'; mid.frequency.value = 1100; mid.Q.value = 0.8;
    const high = context.createBiquadFilter();
    high.type = 'highshelf'; high.frequency.value = 6500;
    source.connect(low);
    low.connect(mid);
    mid.connect(high);
    high.connect(context.destination);
    return { context, element, filters:[low,mid,high] };
  } catch (reason) {
    void context.close();
    throw reason;
  }
}

export function setLocalEqualizer(
  graph: LocalEqualizer, profile: AudioProfile, enabled: boolean
): void {
  const gains = enabled ? AUDIO_PROFILES[profile] : AUDIO_PROFILES.flat;
  const now = graph.context.currentTime;
  for (const [index,value] of [gains.low,gains.mid,gains.high].entries()) {
    graph.filters[index].gain.setTargetAtTime(value,now,0.04);
  }
}
