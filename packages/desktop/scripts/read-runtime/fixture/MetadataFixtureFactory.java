package org.tsugi.fixture;

import eu.kanade.tachiyomi.source.Source;
import eu.kanade.tachiyomi.source.SourceFactory;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Original language metadata crosses the real 100-row inventory boundary. */
public final class MetadataFixtureFactory implements SourceFactory {
    @Override public List<Source> createSources() {
        List<Source> sources = new ArrayList<>();
        for (int index = 0; index < 102; index++) {
            sources.add(new MetadataFixtureSource(20000L + index, "en",
                    String.format(Locale.ROOT, "Tsugi Metadata English %03d", index)));
        }
        sources.add(new MetadataFixtureSource(20102L, "fr", "Tsugi Metadata French"));
        sources.add(new MetadataFixtureSource(20103L, "ja", "Tsugi Metadata Japanese"));
        sources.add(new MetadataFixtureSource(9_007_199_254_740_993L, "all", "Tsugi Metadata All languages"));
        return sources;
    }
}
