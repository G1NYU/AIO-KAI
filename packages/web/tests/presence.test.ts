import { describe, expect, it } from 'vitest';
import {
  defaultPresencePreferences, parsePresencePreferences, PRESENCE_MEDIA, publicPresence,
  publicPresenceText, selectMediaPresence, sharesPresence, validApplicationId,
  type MediaPresence,
} from '../src/lib/presence-model';

const sample = (media: MediaPresence['media']): MediaPresence => ({
  media, title: 'Original fixture title', subtitle: 'Chapter or artist', imdb: 'tt1234567',
  position: 1000, duration: 90000, paused: false, browsing: false,
});
const enabled = () => ({ ...defaultPresencePreferences(), enabled: true, applicationId: '123456789012345678' });

describe('optional Discord sharing', () => {
  it('starts disabled and never inherits upstream opt-ins', () => {
    for (const value of [null, undefined, true, { playing: true }, { enabled: true }, { enabled: 'true' }]) {
      const p = parsePresencePreferences(value);
      for (const media of PRESENCE_MEDIA) expect(sharesPresence(p, media)).toBe(false);
    }
    expect(defaultPresencePreferences().enabled).toBe(false);
    expect(selectMediaPresence(defaultPresencePreferences(), [sample('music')])).toBeNull();
  });
  it('requires a valid explicit application identity without rounding snowflakes', () => {
    for (const id of ['', '123', '123456789012345678x', '123456789012345678 ', '00000000000000000', '18446744073709551616']) expect(validApplicationId(id)).toBe(false);
    expect(validApplicationId('123456789012345678')).toBe(true);
    expect(validApplicationId('18446744073709551615')).toBe(true);
    expect(parsePresencePreferences({ ...enabled(), applicationId: 'bad' }).enabled).toBe(false);
    expect(parsePresencePreferences({ ...enabled(), accessToken: 'secret' })).toEqual(enabled());
  });
  it('private mode blocks every media and per-media controls are independent', () => {
    for (const media of PRESENCE_MEDIA) {
      expect(sharesPresence(enabled(), media)).toBe(true);
      expect(sharesPresence({ ...enabled(), privateMode: true }, media)).toBe(false);
      const p = enabled(); p.media[media] = false;
      expect(sharesPresence(p, media)).toBe(false);
      for (const other of PRESENCE_MEDIA.filter(value => value !== media)) expect(sharesPresence(p, other)).toBe(true);
    }
  });
  it('visible reading outranks background music and closing it restores music', () => {
    const candidates = new Map([['music', sample('music')], ['manga', sample('manga')]]);
    expect(selectMediaPresence(enabled(), candidates.values())?.media).toBe('manga');
    candidates.delete('manga');
    expect(selectMediaPresence(enabled(), candidates.values())?.media).toBe('music');
    candidates.set('books', sample('books'));
    const p = enabled(); p.media.books = false;
    expect(selectMediaPresence(p, candidates.values())?.media).toBe('music');
    candidates.clear(); expect(selectMediaPresence(enabled(), candidates.values())).toBeNull();
  });
  it('projects only public metadata, bounds fields and removes URLs or paths in titles', () => {
    const p = publicPresence({ ...sample('music'), artwork: 'https://secret.invalid', sourceId: 'private', file: 'private' } as MediaPresence);
    expect(Object.keys(p).sort()).toEqual(['media','title','subtitle','imdb','position','duration','paused','browsing'].sort());
    expect(p.imdb).toBeNull();
    for (const value of ['https://private.invalid?token=secret', 'C:\\Users\\private\\file.mp3', 'C:/Users/private/file.mp3',
      '  c:/Users/private/file.mp3  ', '/Users/private/book.pdf', '  /Users/private/book.pdf', '\t/Users/private/book.pdf\n',
      '\u0001/Users/private/book.pdf', 'C\u0001:/Users/private/file.mp3', '\\Users\\private', '\\\\private\\share', 'password=secret']) expect(publicPresenceText(value)).toBe('Private title');
    expect(publicPresenceText('Title\nwith\tcontrols')).toBe('Titlewithcontrols');
    expect(publicPresenceText('  AC/DC  ')).toBe('AC/DC');
    expect(publicPresenceText('  Chapter 1: Opening  ')).toBe('Chapter 1: Opening');
    expect(Array.from(publicPresenceText('🎵'.repeat(200)))).toHaveLength(128);
    expect(publicPresence({ ...sample('music'), position: NaN, duration: Infinity })).toMatchObject({ position: 0, duration: null });
    expect(publicPresence({ ...sample('video'), position: 100000, duration: 90000 })).toMatchObject({ position: 90000, duration: 90000 });
    expect(publicPresence({ ...sample('video'), imdb: 'tt?token=secret' }).imdb).toBeNull();
  });
});
