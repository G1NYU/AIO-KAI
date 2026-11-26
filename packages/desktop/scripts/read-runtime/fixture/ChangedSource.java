package org.tsugi.fixture;

import eu.kanade.tachiyomi.source.ConfigurableSourceKt;

/** Original negative update fixture: changed identity and settings must roll back. */
public final class ChangedSource extends FixtureSource {
    public ChangedSource() {
        // Use the actual synchronous JVM backend. A loaded v3 must have changed
        // both an existing source setting and a newly created settings file.
        // These values are synthetic; no provider or credential is involved.
        if (!ConfigurableSourceKt.sourcePreferences("source_12345").edit()
                .putString("fixture_secret", "tsugi-ci-rejected-old-source-preference").commit()) {
            throw new IllegalStateException("Original fixture existing preference commit failed");
        }
        if (!ConfigurableSourceKt.sourcePreferences("source_54321").edit()
                .putString("fixture_secret", "tsugi-ci-rejected-new-source-preference").commit()) {
            throw new IllegalStateException("Original fixture new preference commit failed");
        }
    }

    @Override public long getId() { return 54321L; }
}
