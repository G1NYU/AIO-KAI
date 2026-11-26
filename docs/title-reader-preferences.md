# Title-specific Reader settings (B4)

In an open manga chapter, open Reader settings and enable **Use settings for this title**. Existing global values become the initial full override snapshot; subsequent layout, direction, size, spacing, appearance, focus, resume and continuous-reading changes affect that title alone. Toolbar, keyboard and Ctrl+wheel actions follow the same selected scope. Disable the toggle or choose **Reset to global settings** to delete that override and inherit the current globals. Existing unscoped behavior remains the default, including global changes from the open reader. Unknown identities have global settings only.

## Identity and storage

Native online/cached manga metadata returns the existing backup identity hash (source ID plus exact manga URL, with length-delimited SHA-256 domain separation), not the raw URL. The key survives runtime numeric ID changes and distinguishes editions from different sources. A changed source URL deliberately does not guess a match. The local versioned store contains at most 512 complete typed records and 128 KiB. Invalid or unknown schema is not rewritten, duplicate identities are rejected, and no existing records are silently evicted. Failed writes leave the active settings unchanged and show an error. Opening a reader does not persist a new record or overwrite global settings.

The existing portable preference archive still contains only global settings; portable title-snapshot merge is an explicit A1 follow-up. This feature does not modify chapter progress, download policy, trackers or source settings.

## Verification

The native test compares the projected hash to the backup identity and proves raw URL removal and changed-source isolation. Web tests cover defaults, separate titles, current globals after reset, invalid/oversized stores, no eviction and write failure. The integrated Reader settings browser fixture uses a separate second title, changes one scope, reloads, checks History uses the correct title resume policy and resets without touching the global preferences. Actual CI and physical acceptance for this revision remain pending.

## Native and cumulative checkpoint

B4 native source at `58ac30c` passed 171 core tests (18 intentionally ignored), including exact stable hash projection, and the actual WebView2 cache-preservation fixture in [Windows job 140181526435](https://github.com/G1NYU/TSUGI/actions/runs/45899503079/job/140181526435). The first web typecheck caught one missing JSX brace; fixed at [`f51f5a7`](https://github.com/G1NYU/TSUGI/commit/f51f5a7068c1e10eb4a340de16b5727069ae4b5d). The [cumulative correction run 45899762782](https://github.com/G1NYU/TSUGI/actions/runs/45899762782) passed typecheck, lint and regression tests and reached browser smoke; browser/native cumulative completion and real-provider/physical acceptance remain pending at this checkpoint.
