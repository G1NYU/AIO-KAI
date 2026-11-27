import { t } from '@lingui/core/macro';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useSettingsLayer } from '@/lib/settings';
import { useOptionalSession } from './session';
import { storage } from '@/lib/storage';
import type { UserDto } from './types';

export type SubtitleMode =
  'Default' | 'Always' | 'OnlyForced' | 'None' | 'Smart';

export const ORIGINAL_LANGUAGE = 'OriginalLanguage';

/** The playback preferences in Jellyfin's user configuration. */
export interface PlaybackPrefs {
  /** A language code, or `OriginalLanguage`; the first of `AudioLanguages`. */
  AudioLanguagePreference?: string | null;
  /** Tried in order, a list this server keeps beside Jellyfin's one language. */
  AudioLanguages?: string[];
  PlayDefaultAudioTrack?: boolean;
  /** Audio kinds in the order a version's track is picked, a list this server keeps. */
  AudioTypes?: string[];
  SubtitleLanguagePreference?: string | null;
  SubtitleLanguages?: string[];
  SubtitleMode?: SubtitleMode;
  /** Subtitle kinds in the order a version's track is picked, a list this server keeps. */
  SubtitleTypes?: string[];
  /** Off only when false. */
  ListPreferredSubtitlesOnly?: boolean;
  EnableNextEpisodeAutoPlay?: boolean;
  /** Off only when false, as in Jellyfin. */
  RememberAudioSelections?: boolean;
  RememberSubtitleSelections?: boolean;
}

// A server without the lists has only the single language.
const languages = (
  list: string[] | undefined,
  one: string | null | undefined
) => (list?.length ? list : one ? [one] : []);

export const audioLanguages = (prefs: PlaybackPrefs) =>
  languages(prefs.AudioLanguages, prefs.AudioLanguagePreference);

export const subtitleLanguages = (prefs: PlaybackPrefs) =>
  languages(prefs.SubtitleLanguages, prefs.SubtitleLanguagePreference);

type Configuration = NonNullable<UserDto['Configuration']>;

const WATCH_PREFS_KEY = 'tsugi-watch-playback-prefs-v1';

/** Keep the same preference schema and menus when no media server is connected. */
export function usePlaybackPrefs() {
  const session = useOptionalSession();
  const client = session?.client, user = session?.user;
  const queryClient = useQueryClient();
  const target = useSettingsLayer()?.userId;
  const queryKey = client
    ? ['jf', client.base, target ?? user?.Id, 'configuration']
    : ['tsugi', WATCH_PREFS_KEY];
  const localPrefs=()=>({AudioLanguages:[],SubtitleLanguages:[],ListPreferredSubtitlesOnly:false,...storage.get<Configuration>(WATCH_PREFS_KEY)} as Configuration);
  const query = useQuery({
    queryKey,
    initialData:client?undefined:localPrefs,
    meta: client && !target ? { cache: 'account' } : undefined,
    queryFn: async (): Promise<Configuration> =>
      !client
        ? localPrefs()
        : target
          ? await client.get<Configuration>(`/Users/${target}/Configuration`)
          : ((await client.get<UserDto>('/Users/Me')).Configuration ?? {}),
    staleTime: 5 * 60_000,
  });
  const save = useMutation({
    mutationFn: async (next: Configuration) => {
      if (!client) { storage.set(WATCH_PREFS_KEY, next); return; }
      if (target) await client.post(`/Users/${target}/Configuration`, next);
      else await client.post('/Users/Configuration', next, { userId: user?.Id });
    },
    onMutate: (next) => queryClient.setQueryData(queryKey, next),
    onError: () => {
      toast.error(t`Could not save that setting`);
      void queryClient.invalidateQueries({ queryKey });
    },
  });
  const prefs = (query.data ?? {}) as PlaybackPrefs;
  // A server can keep a user from changing their own configuration.
  const locked = user?.Policy?.EnableUserPreferenceAccess === false;
  return {
    prefs,
    isLoading: query.isLoading,
    locked,
    update: (patch: PlaybackPrefs) => {
      if (!locked)
        save.mutate({ ...(query.data ?? {}), ...patch } as Configuration);
    },
  };
}
