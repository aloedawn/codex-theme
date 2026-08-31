**Findings**

- [P2] The corrected native command-row rendering has not yet been captured in the installed desktop app.
  Location: Chat/Work inline command rows.
  Evidence: the supplied implementation capture paints `kill -TERM 38134` and `ps -p ...` as bright, unindented text without the native leading icon. The Codex reference keeps the terminal icon, muted foreground, native left inset, truncation, and compact row rhythm. The pseudo-element overlay responsible for that drift has been removed, but no post-restart capture exists.
  Impact: DOM preservation and regression behavior are verified, but final color and spacing parity cannot yet be declared visually passed.
  Fix: open the affected completed Chat/Work turn in the restarted themed app and capture the command rows again.

**Open Questions**

- The approved v18 apply and restart succeeded, but the restored app opened on the blank Work landing screen instead of a turn containing command rows. Computer Use cannot inspect this app identifier, so the affected state must be opened by the user before the final capture.

**Required Fidelity Surfaces**

- Fonts and typography: the command now reuses the native text node's owning element, font, weight, truncation, and antialiasing instead of drawing a separate pseudo-element.
- Spacing and layout rhythm: the native icon, left inset, row height, and surrounding activity-row layout remain owned by the app; the theme changes text content only.
- Colors and visual tokens: the native muted foreground and state opacity remain intact because no theme color is assigned to the command text.
- Image quality and asset fidelity: the app's existing terminal icon is preserved; no replacement asset is introduced.
- Copy and content: the real command remains visible with common secret arguments redacted, and the localized generic status is restored when leaving Chat/Work mode.

**Full-view Comparison Evidence**

- Pre-fix Chat/Work implementation: `/var/folders/8r/rvqqxpqs5h97qpkhykcbptxr0000gp/T/codex-clipboard-aea47ec9-b769-408f-89cc-d29906a59c5d.png` at 1536 x 488 pixels.
- Native Codex target: `/var/folders/8r/rvqqxpqs5h97qpkhykcbptxr0000gp/T/codex-clipboard-d8da87a9-e89d-4089-8222-e5d8abdc2dca.png` at 1750 x 562 pixels.
- Combined comparison: `/private/tmp/codex-theme-command-row-reference.png` at 3084 x 493 pixels. The Codex target was proportionally normalized to 1536 x 493; the supplied Chat/Work capture remains 1536 x 488. CSS viewport and device density are unavailable from the raster captures.
- State: completed and in-progress Chat/Work activity rows compared with native Codex inline command rows under the same dark wallpaper theme.
- Installed v18 startup capture: `/private/tmp/codex-theme-v18-live-20260825-1555.png` at 2560 x 2688 pixels. It confirms the rebuilt theme is active after restart, but the restored blank Work landing state contains no command rows and therefore cannot prove the requested row fidelity.
- Affected-state post-fix screenshot: unavailable until a completed Chat/Work turn containing command rows is opened.

**Focused Region Comparison Evidence**

- No additional crop is required: the supplied Chat/Work image is already focused on the activity feed, and the combined comparison leaves the command icon, color, indentation, and row rhythm readable.

**Comparison History**

1. Before: the theme hid the complete native summary element and drew the command through `::after`, removing the native icon and bypassing its muted text style and layout.
2. Target: Codex keeps the icon and command inside the same compact native activity row.
3. Fix: replace only the existing deepest non-empty text node, preserving the native descendants, classes, color tokens, spacing, truncation, and accessibility tree.
4. Restore behavior: retain the localized original text and restore it when the turn leaves Chat/Work mode or the runtime is disposed.
5. Regression coverage: the test fixture now includes separate native icon and muted-label nodes and verifies both survive replacement and restoration. All 24 tests, generated-bundle parity, syntax, dry-run, and diff checks pass.
6. Live apply/restart: the installed file byte-matches the rebuilt v18 bundle; the themed ChatGPT process restarted successfully and injected the theme at `app://-/index.html`.
7. Post-fix visual evidence: the startup capture shows the blank Work landing state, so command-row comparison remains pending.

**Interaction Verification**

- Secret redaction, command replacement, native icon preservation, native label-class preservation, and localized-text restoration are covered by automated tests.
- The app restarted successfully and the theme injection log reports completion without launcher errors. Command-row pointer, keyboard, and visual verification remain pending because the captured state contains no command row.

**Implementation Checklist**

- [x] Remove the pseudo-element command overlay.
- [x] Replace only the native status text node.
- [x] Preserve native icon, classes, muted color, indentation, truncation, and row sizing.
- [x] Restore the localized original label outside Chat/Work mode.
- [x] Bump the page runtime version to 18 and rebuild `codex-theme.mjs`.
- [x] Pass all 24 tests, bundle parity, syntax, dry-run, and diff checks.
- [x] Back up the prior v16 launcher to `/Users/dawn/Applications/Codex Theme/codex-theme.mjs.backup-20260825-155306`.
- [x] Apply the rebuilt v18 launcher and restart the themed app.
- [x] Capture the post-restart Work landing screen.
- [ ] Open an affected completed Chat/Work turn and capture the revised command rows.

**Follow-up Polish**

- None identified before the required live capture.

final result: blocked
