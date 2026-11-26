package org.tsugi.fixture;

/** Authored installed-source metadata; inherits only the original loopback PNGs. */
public final class MetadataFixtureSource extends DownloadFixtureSource {
    private final long sourceId;
    private final String language;
    private final String label;

    public MetadataFixtureSource(long sourceId, String language, String label) {
        this.sourceId = sourceId;
        this.language = language;
        this.label = label;
    }

    @Override public long getId() { return sourceId; }
    @Override public String getLang() { return language; }
    @Override public String getName() { return label; }
    @Override public boolean getSupportsLatest() { return sourceId == 20000L; }
}
