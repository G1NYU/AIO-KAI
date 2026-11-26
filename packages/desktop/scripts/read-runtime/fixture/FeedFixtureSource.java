package org.tsugi.fixture;

import eu.kanade.tachiyomi.source.model.MangasPage;
import eu.kanade.tachiyomi.source.model.SManga;
import java.util.List;
import rx.Observable;

/** Authored Feed pages; image requests use the shared original loopback server. */
public final class FeedFixtureSource extends DownloadFixtureSource {
    private final long sourceId;

    public FeedFixtureSource(long sourceId) { this.sourceId = sourceId; }

    @Override public long getId() { return sourceId; }
    @Override public String getName() {
        return sourceId == 12345L ? "Tsugi Feed Fixture" : "Tsugi Feed Fixture " + sourceId;
    }
    @Override public boolean getSupportsLatest() { return sourceId == 12345L; }

    private MangasPage feedPage(int page, boolean latest) {
        if (page < 1 || page > 2) return new MangasPage(List.of(), false);
        SManga manga = SManga.Companion.create();
        if (!latest && page == 1) {
            manga.setUrl("/original-comic");
            manga.setTitle("Tsugi Original Comic");
        } else {
            String mode = latest ? "Latest" : "Popular";
            manga.setUrl("/feed/" + (latest ? "latest-" : "popular-") + page);
            manga.setTitle("Tsugi Feed " + mode + " " + page);
        }
        manga.setAuthor("Tsugi CI");
        return new MangasPage(List.of(manga), page == 1);
    }

    @Override public Observable<MangasPage> fetchPopularManga(int page) {
        return Observable.just(feedPage(page, false));
    }

    @Override public Observable<MangasPage> fetchLatestUpdates(int page) {
        return Observable.just(feedPage(page, true));
    }
}
