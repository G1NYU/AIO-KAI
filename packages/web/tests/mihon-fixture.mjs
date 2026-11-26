// Synthetic sanitized wire fixtures authored from Mihon's maintained v0.21.3
// Backup{,Manga,Chapter,History,Category,Source} @ProtoNumber definitions:
// https://github.com/mihonapp/mihon/tree/v0.21.3/app/src/main/java/eu/kanade/tachiyomi/data/backup/models
// These are schema fixtures, not a claim of a physical Android export test.
export function varint(value) {
  let n = BigInt.asUintN(64, BigInt(value));
  const out = [];
  do { const low = Number(n & 127n); n >>= 7n; out.push(low | (n ? 128 : 0)); } while (n);
  return Uint8Array.from(out);
}
export function bytes(...values) { return new Uint8Array(Buffer.concat(values)); }
export function integer(field, value) { return bytes(varint(field * 8), varint(value)); }
export function message(field, value) { return bytes(varint(field * 8 + 2), varint(value.length), value); }
export function string(field, value) { return message(field, new TextEncoder().encode(value)); }

export const fixtureIdentity = {
  sourceId: '9007199254740993', url: '/manga/mihon-fixture', title: 'Mihon fixture',
};
export const fixtureChapters = [
  { url: '/manga/mihon-fixture/complete', name: 'Complete chapter', read: true, bookmark: false, page: 19 },
  { url: '/manga/mihon-fixture/bookmark', name: 'Bookmarked chapter', read: false, bookmark: true, page: 0 },
  { url: '/manga/mihon-fixture/partial', name: 'Partial chapter', read: false, bookmark: false, page: 7 },
];
export function chapterWire(chapter) {
  return bytes(string(1, chapter.url), string(2, chapter.name), integer(4, chapter.read ? 1 : 0), integer(5, chapter.bookmark ? 1 : 0), integer(6, chapter.page));
}
export function mangaWire({ sourceId = fixtureIdentity.sourceId, url = fixtureIdentity.url, title = fixtureIdentity.title,
  favorite, chapters = fixtureChapters, categories = [2, 8], packed = false, history = chapters.map(chapter => ({ url: chapter.url, at: 1700000000123n })), extra = new Uint8Array() } = {}) {
  return bytes(integer(1, sourceId), string(2, url), string(3, title),
    ...chapters.map(chapter => message(16, chapterWire(chapter))),
    ...(packed ? [message(17, bytes(...categories.map(varint)))] : categories.map(value => integer(17, value))),
    ...history.map(entry => message(104, bytes(string(1, entry.url), integer(2, entry.at), integer(3, 1200)))),
    ...(favorite === undefined ? [] : [integer(100, favorite ? 1 : 0)]), extra);
}
export function categoryWire(name, order, id = 99) { return bytes(string(1, name), integer(2, order), integer(3, id)); }
export function mihonFixture({ manga = [mangaWire()], categories = [categoryWire('Reading', 2), categoryWire('Later', 8)], sourceId = fixtureIdentity.sourceId, extra = new Uint8Array() } = {}) {
  return bytes(...manga.map(value => message(1, value)), ...categories.map(value => message(2, value)),
    message(101, bytes(string(1, 'Fixture source'), integer(2, sourceId))), extra);
}
