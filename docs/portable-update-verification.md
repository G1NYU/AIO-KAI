# Read-only portable archive verification (A2)

This is the verification boundary of native updates, not an installer or updater. The module uses a single opened regular-file handle and checks an expected release size, lower-case SHA-256 and source commit selected from a trusted release. The diagnostic example takes those values explicitly; it does not discover or trust a digest inside the archive. The same-feed digest detects corruption and identity mismatch, not an independent publisher signature.

## Supported package format

- Windows x64, ordinary single-disk ZIP with stored or deflated entries. Limits: 2 GiB archive, 4 GiB decompressed total, 1 GiB per file, 4096 entries, 4 MiB central directory. Cancellation is checked during hash, directory review and decoding.
- Validate central/local names, flags, sizes, offsets, data descriptors and CRC, rejecting overlaps, unclaimed bytes, duplicate and case-aliased names, file/directory conflicts, unsafe Windows names, traversal, alternate path fields, encrypted files, links and special entries. The deliberately strict layout rejects ZIP64 and archive comments.
- Only fixed portable root metadata and immutable current/ contents; no embedded mutable data, WebView2 profile, downloaded Reader tools or legacy executable. Check required app, web, runtime tools, licenses, source notices and new design assets. Check x64 PE machine and PE32+ identity for required executable/DLL files.
- BUILD-INFO.json must match the selected source commit, repository, run identity and known ref; future builds declare package_format 1 and architecture windows-x64. A single exact legacy tuple is accepted for read-only verification of the published v0.1.0: commit e8e7140fe20ae265ffae4e559a45f939dd5b243b, 173235714 bytes, SHA-256 e26fb604d39a1b6a13c6e976f2f820bc6338ee044a21d5c8451d1ed68fa2cd65. No legacy exception is inferred from a supplied file or version label.

## Verification

From packages/desktop on Windows:

```powershell
cargo test --locked -p aiostreams-desktop-core portable_package
cargo run --locked -p aiostreams-desktop-core --example verify_tsugi_package -- <zip> <expected-bytes> <sha256> <source-commit>
```

From the repository root, the opt-in acceptance command downloads the exact published stable archive to a unique temporary directory, validates its byte count and hash again, and runs the example:

```powershell
pwsh -File packages/desktop/scripts/verify-published-package.ps1
```

Unified Windows CI runs this extra read-only probe only for commits carrying the explicit [verify portable package] marker. It neither builds a portable artifact nor modifies an existing installation. The temporary downloaded ZIP is removed by its owned fixture cleanup.

Six synthetic native tests cover complete stored/deflated archives, wrong checksum/size/commit, inventory and PE architecture, hostile entry names, CRC, cancellation, malformed directory, link metadata, local/central mismatch and unknown manifest. Exact Windows compile/test and published-archive results are pending at this checkpoint.

## Remaining A2 boundary

Before apply: verified release selection, bounded download and private staging, safe extraction and re-verification, update preview/explicit consent, app shutdown/locking, persistent crash-safe replacement and rollback journal, protection of actual user data and Windows fault-injection across restart. No live installation writes, migration, downgrade or updater execution are enabled by this diagnostic module.

## Initial native build correction

The first [Windows compile](https://github.com/G1NYU/TSUGI/actions/runs/45898094868/job/140176884281) reported that ZIP 8.6 returns an optional data offset. Compare it to Some(entry.data), not the raw integer. This preserves the requirement that the decoder and bounded central/local directory review agree. The compile, six tests and exact stable archive probe are being rerun by cumulative CI; this is not verified package acceptance yet.
