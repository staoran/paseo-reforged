---
name: release-stable
description: Cut a formal-channel release of Paseo Reforged after its version, updater, signing, and publication gates are implemented. Use when the user says "release stable", "ship stable", "promote", or "/release-stable".
user-invocable: true
---

# Release stable

Read `docs/release.md` and follow the **Standard release (stable)** flow. Run the **Stable release (or promotion)** completion checklist at the bottom of that doc.

The adopted formal-channel format is `X.Y.Z-reforged.N`: `X.Y.Z` is the adopted upstream base, and `N` is the public Reforged formal-release ordinal on that base. Reset `N` when a newer upstream base is adopted; do not claim the next upstream patch or minor version.

Do not cut a formal release while any prerequisite remains open. The current parser, promotion command, GitHub stable workflow, Electron stable updater, and macOS signing/notarization gate do not yet support this channel end-to-end. Never substitute the blocked `release:patch`, `release:minor`, or `release:promote` commands; report the gate and stop.

The doc covers the changelog, pre-release sanity check, and post-release babysit pattern. Don't skip steps.
