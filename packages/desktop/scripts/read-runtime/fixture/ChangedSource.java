package org.tsugi.fixture;

/** Original negative update fixture: a changed source ID must be rolled back. */
public final class ChangedSource extends FixtureSource {
    @Override public long getId() { return 54321L; }
}
