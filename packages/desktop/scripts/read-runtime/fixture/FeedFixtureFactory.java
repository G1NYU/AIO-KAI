package org.tsugi.fixture;

import eu.kanade.tachiyomi.source.Source;
import eu.kanade.tachiyomi.source.SourceFactory;
import java.util.ArrayList;
import java.util.List;

/** Cross the real 100-row inventory boundary without contacting any provider. */
public final class FeedFixtureFactory implements SourceFactory {
    @Override public List<Source> createSources() {
        List<Source> sources = new ArrayList<>();
        for (int index = 0; index < 101; index++) {
            long id = index == 100 ? 9_007_199_254_740_993L : 12345L + index;
            sources.add(new FeedFixtureSource(id));
        }
        return sources;
    }
}
