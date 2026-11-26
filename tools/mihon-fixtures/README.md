# Mihon backup writer compatibility fixture

`packages/web/tests/fixtures/mihon-writer/mihon-v0.21.3.tachibk` contains original,
sanitized test data encoded by the actual `BackupWriter` from
[Mihon v0.21.3](https://github.com/mihonapp/mihon/tree/feadad5e1e2bf638be6e2ca317d11657b09d4596).
The generator also verifies that the writer's output equals a whole-backup
`kotlinx.serialization.protobuf` encoding and that the upstream reader reopens it.

This is stronger than manually arranging protobuf bytes, but it is **not an
export from an Android installation**. Physical import of a user-approved backup
remains a distinct acceptance check.

The generator downloads the pinned upstream sources and verifies every git blob
identity. It keeps the writer and serialized constructor declarations unchanged.
Only unrelated Android/domain conversion methods and their imports are omitted
for standalone compilation. The original default JSON byte array and source
update-strategy enum are retained. Kotlin, serialization and Okio versions match
the pinned upstream version catalog. Dependencies are build tools only; they are
not shipped with TSUGI.

Run with Python 3 and Java 21:

```sh
python tools/mihon-fixtures/generate.py --java /path/to/java
```

The checked-in provenance records source blob identities, build dependency
SHA-256 digests, fixture lengths and hashes. Maven Central checksum sidecars
verify the downloaded build artifacts; hashes do not provide independent
publisher authentication. Regeneration uses a temporary cache outside the
repository and deterministic gzip metadata.

Fixture coverage: signed source IDs beyond JavaScript's integer precision,
Unicode titles, category order versus category ID, an empty category, read and
bookmarked chapters, partial pages, history timestamps, legacy and current
tracker IDs, a title outside the library, and synthetic private-setting markers
that must not enter portable output. No accounts, real cookies, user library or
provider requests are involved.

Mihon's upstream source is Apache-2.0 licensed; the source remains at its pinned
[repository](https://github.com/mihonapp/mihon/blob/feadad5e1e2bf638be6e2ca317d11657b09d4596/LICENSE).
The generator does not redistribute the downloaded compiler or upstream source.
