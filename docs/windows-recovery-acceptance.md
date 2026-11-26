# Windows portable recovery check

Candidate source revision: `8d6b25bec7942eaa216fe321bbb54084ab137584`. Use the `Tsugi-Windows-x64-test` artifact from [Windows run 45765848932](https://github.com/G1NYU/TSUGI/actions/runs/45765848932). Extract the inner test ZIP twice to new empty folders, for example `Tsugi-A` and `Tsugi-B-日本語`. Keep the companion files and .portable marker in both. Confirm the commit in each BUILD-INFO.json. Launch current/Tsugi.exe from one copy at a time.

| Check | Action | Expected observation |
|---|---|---|
| Source copy | In A, pick a distinct theme, save a small playlist and import a disposable EPUB or PDF. Read a few pages and close the book. For manga, use a trusted source and bookmark a chapter. | Reopening A preserves the chosen items and positions. |
| Capture | Under Data & storage, export a portable archive, confirm the file exists, and save a managed backup. Reopen the managed copy for preview. | Expected sections and counts appear. Preview preserves current settings. |
| Fresh destination | Close A. Open B and open the exported archive. Review preferences, change one target setting, then attempt Apply. Review again and apply. Merge music, reconnect trusted sources and reimport the same book before reviewing book progress. | First preferences apply detects a stale review. The second succeeds. Unavailable titles/files are identified. The matched book resumes on the saved page after restart. |
| Idempotency | Reopen the same archive in B and review the same domains again. | Already merged tracks and matching manga changes do not duplicate. Newer local progress survives. |
| Scoped cleanup | In B, scan app storage. With a disposable poster cache, review cached artwork, cancel and review again. Confirm removal and reopen the book, manga library and playlist. | Cancel retains images. Confirmation affects the reviewed artwork only. Without cached artwork the panel reports zero and offers no removal. |
| Damaged archive | Open a truncated copy of the exported JSON in B. Reopen A separately afterwards. | B reports an invalid archive before enabling apply. A's original data and progress are intact. |

Report the build commit, Windows version, and pass/fail for each exercised row. For a failure, the first failing action and visible error are sufficient. Keep personal archives, private source addresses and account details on the device. This check covers only the behavior above. Interrupted multi-domain restore and downloaded chapter cleanup require separate evidence.
