# Music lyrics and recording timing

Lyrics are an explicit action in the expanded Music player. TSUGI queries
[LRCLIB](https://lrclib.net/docs.txt) with public title and artist metadata, using
anonymous browser requests and the documented client-identification header.
It does not send source configuration, track IDs, stream URLs, cookies or keys.

## Choosing a recording

The lyrics selector requires exact normalized title and artist agreement. It
ranks results using the **actual media duration reported by the player** and,
when available, the selected album. The player may show a catalog estimate
before media metadata arrives, but that estimate never confirms lyric timing.
Until a valid decoder duration arrives, lyrics remain unconfirmed. A material
later duration change cancels the earlier lookup and invalidates its displayed
result. Decoder variation below 50 milliseconds is ignored for this identity,
so tiny metadata changes do not repeat a lookup or reset a correction. Matching
otherwise uses the unrounded reported duration.

Automatic timestamp following requires a valid provider record, duration within
two seconds, album agreement when an album is known, and no competing matched
record with different timestamps. Identical lyrics on multiple releases do not
alone make the timing ambiguous. Missing duration/identity, incompatible albums,
unsupported embedded LRC offsets, or timestamps extending beyond the declared
recording leave timing unconfirmed.

These checks establish metadata agreement. They do not acoustically verify the
provider's timestamps. LRCLIB's own duration-matching guidance uses a two-second
tolerance; its search response remains a collection of candidate records.

## Music videos and uncertain timing

YouTube Music's explicit song/video distinction is retained in search results,
home shelves, saved tracks and recent playback. Older saved video entries can
also be recognized from the exact same-video YouTube thumbnail path.
Restored or older native YouTube entries without that distinction remain
unconfirmed; TSUGI does not assume they are studio songs or change the portable
backup format to add it.

A video can have an introduction, dialogue, credits or internal edits that are
absent from a studio recording. Even matching total duration does not prove that
the lyric timeline matches. Known videos therefore start with plain lyrics and
an unconfirmed-timing message, without automatic highlighting or lyric seeks.
Other ambiguous recordings use the same behavior.

Investigation of the reported “Without Me” case found public YouTube Music video
metadata of 4:58 and LRCLIB studio records of 290 seconds. A 298-second LRCLIB
compilation record contained the same timestamps as the studio records, as did
several records with substantially different durations. No fixed offset was
inferred from those total lengths. No copyrighted lyric text or provider images
from this investigation are included in the repository.

## Adjusting timing

Open **Adjust lyrics timing** to reveal the controls. Normal timed-line clicks
continue to seek the audio. **Match a sung line** explicitly changes that mode:
listen and select the line currently being sung. TSUGI records the difference
between its timestamp and the current playback position; it does not seek or
alter the audio when making this alignment.

The same correction is used for highlighting, displayed timestamps and later
line seeks:

`media time for a line = provider timestamp + lyrics offset`

A positive offset delays the lyrics. **Lyrics earlier** subtracts half a second;
**Lyrics later** adds half a second. Corrections are bounded to two minutes in
either direction. **Reset timing** removes the correction. A video or uncertain
recording returns to plain, unconfirmed lyrics after reset.

Corrections are kept only in a bounded session map of 32 entries. Their identity
includes the exact source, track ID, media duration and selected lyric content.
They do not apply to another source or recording and are not written to local
storage, exported in backups, or sent to a service. Switching layouts or reopening
the same recording retains its adjustment during the current app page session;
reloading or restarting clears the session map.

The imported Studio player uses the same selection and correction state. Its
lyric layer and player-options menu provide access to the timing panel.

## Verification and limits

Unit regressions cover actual versus catalog duration, album and ambiguous
selection, video identity preservation, offset sign, matching line-seek times,
reset and source/recording isolation. The browser regression uses original lyric
fixtures, controlled native playback events (including playing with unknown
duration and later valid metadata) and an original 188-second PCM file
served over HTTP with byte-range support. It checks native and HTML audio
highlight/seek behavior, imported Studio controls, stable corrections under tiny
duration changes, and narrow-screen controls without contacting providers.

The native audio worker reports mpv's
[file position in seconds](https://mpv.io/manual/master/#command-interface-time-pos);
browser playback reports `HTMLMediaElement.currentTime`. Lyrics do not use a
separate elapsed-time counter. The investigation did not establish a native
clock drift defect, and this change does not modify either playback clock.

A fixed correction cannot repair tempo drift or multiple cuts within a video.
Those cases may need another explicit alignment later in the recording, or a
different lyric record. Physical Windows listening against the user's selected
video remains a separate acceptance check; controlled tests do not prove that
every public provider timestamp matches its audio.
