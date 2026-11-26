package org.tsugi.fixture;

import eu.kanade.tachiyomi.source.model.SManga;
import rx.Observable;

/** Original CI-only thumbnail using the same isolated page server as the comic. */
public class CacheFixtureSource extends DownloadFixtureSource {
    @Override public Observable<SManga> fetchMangaDetails(SManga manga) {
        manga.setThumbnail_url(getBaseUrl() + "/original-comic/chapter-3/page-1.png");
        return Observable.just(manga);
    }
}
