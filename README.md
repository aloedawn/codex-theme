# Codex Theme Variants

This repository keeps the two customization directions as separate, independently buildable variants.

## Variants

- [`Work_to_Codex`](Work_to_Codex): the default variant. It shows ChatGPT web projects and conversations inside Codex mode's existing **Projects** and **Recents** sections.
- [`Codex_to_Work`](Codex_to_Work): the earlier variant. It brings additional Codex review, detail, and Quick chat behavior into ChatGPT Work and Chat modes.

Each folder contains its own source, tests, generated `codex-theme.mjs`, installer, launcher, app wrapper, and media assets. The folders do not share runtime source, so changes made for one direction cannot silently enter the other.

## Default install

The repository-level installer intentionally forwards to `Work_to_Codex`:

```sh
./install.sh
open "$HOME/Applications/Codex Theme/Codex.app"
```

Install a specific variant directly when switching directions:

```sh
./Work_to_Codex/install.sh
./Codex_to_Work/install.sh
```

Both installers target `~/Applications/Codex Theme` by default, so installing one replaces the previously installed variant without modifying the official ChatGPT app.

## Development

The top-level commands validate both variants:

```sh
npm run build
npm test
npm run check
```

Variant-specific commands are also available:

```sh
npm run build:wtc
npm run test:wtc
npm run check:wtc

npm run build:ctw
npm run test:ctw
npm run check:ctw
```
