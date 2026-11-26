package org.tsugi.fixture;

import android.content.SharedPreferences;
import androidx.preference.EditTextPreference;
import androidx.preference.PreferenceScreen;
import eu.kanade.tachiyomi.source.ConfigurableSource;
import eu.kanade.tachiyomi.source.ConfigurableSourceKt;
import eu.kanade.tachiyomi.source.online.HttpSource;
import eu.kanade.tachiyomi.source.model.FilterList;
import eu.kanade.tachiyomi.source.model.MangasPage;
import eu.kanade.tachiyomi.source.model.SManga;
import eu.kanade.tachiyomi.source.model.SChapter;
import java.util.List;
import java.util.Locale;
import rx.Observable;

/** Original deterministic source; no external network requests. */
public class FixtureSource extends HttpSource implements ConfigurableSource {
    @Override public long getId() { return 12345L; }
    @Override public String getName() { return "Tsugi Fixture"; }
    @Override public String getLang() { return "en"; }
    @Override public String getBaseUrl() { return "https://example.invalid"; }
    @Override public boolean getSupportsLatest() { return true; }
    @Override public FilterList getFilterList() { return new FilterList(List.of()); }

    // Original test-only value. Register a real configurable-source setting so
    // recovery tests exercise the runtime's JavaSharedPreferences persistence.
    @Override public SharedPreferences getSourcePreferences() {
        return ConfigurableSourceKt.sourcePreferences("source_" + getId());
    }

    @Override public void setupPreferenceScreen(PreferenceScreen screen) {
        EditTextPreference preference = new EditTextPreference(screen.getContext());
        preference.setKey("fixture_secret");
        preference.setTitle("Original recovery fixture setting");
        preference.setDefaultValue("");
        screen.addPreference(preference);
    }

    private MangasPage catalogue(int page, String query) {
        if (page != 1 || !("tsugi original comic".contains(query.toLowerCase(Locale.ROOT)))) {
            return new MangasPage(List.of(), false);
        }
        SManga manga = SManga.Companion.create();
        manga.setUrl("/original-comic");
        manga.setTitle("Tsugi Original Comic");
        manga.setAuthor("Tsugi CI");
        return new MangasPage(List.of(manga), false);
    }

    @Override public Observable<MangasPage> fetchPopularManga(int page) {
        return Observable.just(catalogue(page, ""));
    }
    @Override public Observable<MangasPage> fetchLatestUpdates(int page) {
        return Observable.just(catalogue(page, ""));
    }
    @Override public Observable<MangasPage> fetchSearchManga(int page, String query, FilterList filters) {
        return Observable.just(catalogue(page, query));
    }

    @Override public Observable<SManga> fetchMangaDetails(SManga manga) {
        return Observable.just(manga);
    }

    @Override public Observable<List<SChapter>> fetchChapterList(SManga manga) {
        SChapter chapter = SChapter.Companion.create();
        chapter.setUrl("/original-comic/chapter-1");
        chapter.setName("Original chapter");
        chapter.setChapter_number(1.0f);
        return Observable.just(List.of(chapter));
    }
}
