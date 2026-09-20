# This fork

A private fork of [Slint](https://github.com/slint-ui/slint), patched for the *redust* Redis explorer.
Upstream is only ever **read from**; nothing here is published to GitHub.

## Layout

| Ref | What it is |
|---|---|
| `vX.Y.Z` tags | The upstream release tags, with their real history. |
| `patched/X.Y.Z` | Upstream `vX.Y.Z` plus this fork's patches, one commit per feature. **This is what redust builds against.** |
| `upstream` remote | `https://github.com/slint-ui/slint.git`, fetch only (its push URL is set to something that fails on purpose). |

A patched branch is always *upstream tag + a short series of commits*, so
`git log vX.Y.Z..patched/X.Y.Z` is the complete list of what differs from upstream, and
`git diff vX.Y.Z patched/X.Y.Z` its diff. There is no other divergence (no vendored files,
no edited lock files).

Older history: `main` on the server is the state before this layout existed (the 1.17.1 sources
copied in without git history, with the patches applied on top). `patched/1.17.1` is the same
content rebuilt on upstream's real history.

## The patches

| Commit subject | Files | Why |
|---|---|---|
| flickable: leave Ctrl+wheel to the ancestors | `internal/core/items/flickable.rs` | Ctrl+wheel is the app's zoom; a Flickable used to swallow it. |
| software renderer: hint glyph outlines | `internal/renderers/software/fonts/vectorfont.rs` | Crisper small text on Windows. |
| winit software renderer: always present the whole buffer | `internal/backends/winit/renderer/sw.rs` | Damage-only presents left the window transparent after a DPI change / snap / un-minimize. |
| styled-text: add StyledText::from_colored_paragraphs | `internal/core/styled_text.rs` | Build colored text from tokenized data without markdown. |
| styled-text: read-only selection, copy, click and drag callbacks | `builtin_elements.rs`, `items/text.rs`, `item_rendering.rs`, `renderer.rs`, `textlayout/sharedparley.rs`, `sharedparley/shaping.rs` | Select / copy / click on `StyledText`, drag auto-scroll hooks. Test: `tests/cases/elements/styledtext-selection.slint`. |
| styled-text: add an `overflow` property (clip \| elide) | `builtin_elements.rs`, `items/text.rs`, `sharedparley/draw.rs` | `overflow: elide` on `StyledText`, and one ellipsis per line instead of per glyph run. Test: `tests/cases/elements/styledtext-overflow.slint`. |
| text-input: add `clear-focus-on-outside-press` | `builtin_elements.rs`, `items/text.rs`, `items/input_items.rs`, `window.rs` | Desktop-like blur of a `TextInput` on an outside click. Test: `tests/cases/focus/text-input-outside-press.slint`. |
| window: fall back to the nearest visible ancestor when the focused item is culled | `internal/core/window.rs` | Key events were lost when the focused item was scrolled out of a virtualized list. |
| examples: add selection-demo | `examples/selection-demo/` | Manual playground for the StyledText features (standalone workspace). |

(Paths are relative to `internal/core/` unless they say otherwise.)

## Backports from upstream

Fixes that upstream made after a release and that this fork needs before the next one. They are
cherry-picks (`git cherry-pick -x`, so the message names the upstream commit) and sit on top of
the patches above.

| Upstream commit | Why | Drop when |
|---|---|---|
| `42ae7e95d` winit: Don't claim that hiding a window failed when it didn't (#13507) | Slint 1.18.0 keeps a reference to the winit window while it dispatches an event, so closing a window from inside a UI event (the close button) printed "request to hide window failed because references to the window still exist", and left the window registered. Fixed on upstream `master`. | A release contains it (likely 1.18.1). The upgrade script will stop on this commit: `git rebase --skip`. |

Conflict resolved when backporting: 1.18.0's `dispatch_winit_window_event` takes the event by
value, upstream `master` by reference.

## Upgrading to a new Slint release

```sh
scripts/fork-upgrade.sh v1.18.0 v1.19.0     # creates patched/1.19.0 from patched/1.18.0
```

It fetches upstream, then `git rebase --onto v1.19.0 v1.18.0` on a new branch. `rerere` is
enabled, so a conflict you resolved once is resolved the same way next time. When a conflict shows
up, resolve it, `git add`, `git rebase --continue`. If upstream reshaped the code a patch touched
(see below), re-implement the patch on the new structure rather than forcing the old text in: keep
the commit's intent and message.

Then check, with a `CARGO_TARGET_DIR` outside of `/tmp` (the builds are several GB):

```sh
cargo check -p slint --features unstable-winit-030
cargo test -p i-slint-core -p i-slint-compiler -p i-slint-renderer-software
cargo test --manifest-path tests/Cargo.toml -p test-driver-interpreter            # ~1000 cases, about a minute
SLINT_TEST_FILTER=styledtext-selection cargo test --manifest-path tests/Cargo.toml -p test-driver-rust --test elements
SLINT_TEST_FILTER=text-input-outside-press cargo test --manifest-path tests/Cargo.toml -p test-driver-rust --test focus
```

(The interpreter driver only checks that a case compiles and that its `test` property is true; the
`rust` blocks with the mouse scenarios run in the Rust driver.)

Finally build redust against the branch without touching its `Cargo.toml`, in a copy of the
project:

```toml
[patch."https://git.leopa.rent/iRed4321/SlintFork.git"]
slint = { path = "/path/to/SlintFork/api/rs/slint" }
slint-build = { path = "/path/to/SlintFork/api/rs/build" }
```

and run `cargo test` and `cargo test -- --ignored` (the latter renders the real window).

Publish with `git push origin patched/1.19.0`, and point redust's `branch = "..."` at it.

## Places that move between Slint versions

Where the patches broke last time (1.17 -> 1.18), and so where to look first:

- **Element declarations.** Up to 1.17 they were in `internal/compiler/builtins.slint`; from 1.18
  they are Rust, in `internal/compiler/builtin_elements.rs` (`item! { StyledTextItem ... }`,
  `item! { TextInput ... }`). New properties and callbacks are declared there in the same syntax,
  and must match the fields of the Rust item struct.
- **Shared text layout.** `internal/core/textlayout/sharedparley.rs` was split into
  `sharedparley/{cache,draw,layout,selection,shaping}.rs` and text goes through a layout cache
  (`with_text_layout`). The selection patch hooks into `draw_text` (highlight),
  `shaping::create_text_paragraphs` (real byte ranges for styled paragraphs) and adds
  `render_text_byte_offset_for_position` next to `text_input_byte_offset_for_position`.
- **Software renderer glyphs.** 1.18 places glyphs with sub-pixel accuracy, which made the old
  "round the glyph position" patch obsolete (dropped). Keep an eye on the hinting patch when this
  code changes again.
- **winit software renderer present.** Upstream now presents the actual damaged rectangles
  (`present_with_damage`); the patch replaces that with a full `present()`.
- **Upstream `max-lines` on `StyledText`** (new in 1.18) overlaps with our `overflow: elide`;
  if upstream ever grows an `overflow` of its own, drop ours.

## Rules

- Keep one commit per feature, with the reason in the message. Fix-ups go into the feature's
  commit (`git commit --fixup <commit>` then `git rebase -i --autosquash <upstream tag>`), so the
  series stays short and each commit stays rebase-able.
- A feature commit brings its own test when it can have one.
- Backports (cherry-picks of upstream fixes) go on top of the patches and get a row in "Backports".
- Never push to `upstream`. Never publish this repository.
