# Large directory rendering

The desktop Explorer uses a disk-backed snapshot instead of passing all directory
entries through Tauri IPC. A native blocking task enumerates direct children,
sorts batches of 4,096 records, and merges at most 32 runs at a time. The final
snapshot has a sparse byte-offset index for direct page reads. Records and offsets
live in a temporary directory that is removed when the snapshot is released.
Sorting keeps folders first, supports name/size/time and ascending/descending
order, and compares digit runs naturally (`note2` before `note10`). Unicode names
use case-folded code-point ordering rather than the browser's locale collation.

The frontend fetches pages of 256 records, retains at most 16 pages (4,096 records),
and coalesces scroll requests to the latest viewport. It renders visible rows plus
six buffer rows behind and up to 48 ahead, according to velocity and direction.
The physical scrollbar is capped at 1,000,000
pixels; logical offsets, wheel movement and keyboard navigation still address the
entire listing at 32 pixels per row. New-file input stays below the viewport and
an active rename input stays mounted while scrolling.

Scroll input is accumulated in refs and committed once per animation frame.
Above two logical pixels per millisecond, rows retain filenames, colored SVG
icons and file actions; tooltips and plugin badge matching return
after 120 milliseconds without movement. Active rename inputs retain full UI.
Viewport page reads take priority over buffers and speculative prefetch. Measured
IO latency and scroll velocity control a forecast of up to six pages in the
direction of travel, with one page behind for reversals. There are at most two
reads in flight for the current snapshot, with at most one speculative read.
Results/errors from superseded viewports are discarded, useful visible pages are
protected during eviction, and completed reads are published in animation-frame
batches. A native page read already in flight cannot be interrupted; its obsolete
result is ignored.

Navigation, closing, refresh and sorting cancel or release the preceding native
snapshot. Directory watcher refreshes use the same paged path. Browser demo and
Android SAF sources retain their existing loading APIs, with virtual rendering;
their providers still materialize directory contents in memory. Footer breadcrumb
popups also retain their existing listing API.

Project mode uses a sparse tree of expanded directory segments. Each expanded
native directory owns an independent snapshot scope, with a shared 16-page
frontend cache. Expanding a node never flattens its descendants into an array.
Expand selected walks all subdirectories in bounded pages, yields between pages,
and stops on Collapse all, root navigation or disposal. Canonical directory
identities prevent recursive symbolic-link loops.

Filename search is recursive in project mode and limited to the displayed folder
in file mode. It matches filename substrings, includes folders and supports case
sensitivity. Native explorer searches stream directory iterators and retain at
most 1,000 matches; `+` after the result count indicates truncation. Search reveals
ancestor nodes and locates off-cache results within disk snapshots.

Root changes retain the previous viewport until the new first page is resident.
An inert snapshot bridges a single 260ms transition; the virtual scroll container
remains mounted and the new root starts at offset zero, even if the old root sorts
thousands of siblings below it. Reduced-motion preferences skip the animation.

Empty project folders have no extra text/status row. Expansions preload the first
child page before exposing it; scrolling retains the resident, inert viewport
until requested visible rows arrive, without skeleton replacements.
When a native parent snapshot is built, every direct child directory is checked
with `read_dir` and one iterator step. Empty/readable/unreadable state travels
with its row through external sorting and paging, so no child expansion is needed
to decide its arrow. Browser/SAF providers annotate the parent listing using at
most four concurrent checks and stop queued work when that source closes. A fresh
child listing overrides older parent metadata, including after creating the first
file inside an empty directory.

New-file drafts occupy a virtual row at the end of the last clicked directory
(the root by default). A closed target is opened before the draft is revealed;
collapsing the root disables Explorer's New File action. Committing to a child
refreshes that directory's own snapshot instead of changing the project root.

Visible long filenames grow a bounded content-width measurement shared by the
horizontal scroller. Search opens ancestor nodes, reveals the matching row and
scrolls the matched substring into view. Editable rows keep a fixed width so
input padding and text measurement cannot recursively grow the content width.
ResizeObserver callbacks schedule their layout writes in an animation frame and
skip unchanged values.

## Verification and limits

- `npx vitest run src/components/layout/sidebar/explorer/VirtualFileList.test.jsx src/services/workspaceFiles.test.js`
- `npx playwright test --config tests/playwright.config.mjs tests/e2e/virtual-files.spec.mjs`
- `node scripts/rust.mjs test --manifest-path src-tauri/Cargo.toml --lib --locked directory_index::tests`

The frontend tests use a synthetic 10,000,000-row source without allocating a
10,000,000-item array. Browser tests also cover a 100-event burst, 60 consecutive
forward/reverse frames with 80ms simulated page IO, final filename correctness,
detail restoration, and the concurrency/DOM/cache bounds. These are behavioral
stress tests rather than an FPS or real-disk latency guarantee.
Native tests force multiple merge passes with 135,185
records and verify arbitrary page reads, ordering, cancellation and cleanup.
These tests verify the rendering/data-access architecture, not the elapsed time
to enumerate ten million real filesystem entries. Initial globally sorted output
requires a complete scan and external sort, with temporary disk space proportional
to the listing size. Actual scan time depends on storage and directory metadata
cost; the UI thread is not used for that work. A snapshot reflects the scan's
metadata; create/delete/rename events rebuild it, and manual refresh updates
content-only metadata changes as well.
