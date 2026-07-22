---
name: release-stable
description: Cut a stable release of Paseo Reforged (fresh patch or minor, or promote from beta). Use when the user says "release stable", "ship stable", "promote", "release:patch", "release:minor", "release:promote", or "/release-stable".
user-invocable: true
---

# Release stable

Read `docs/release.md` and follow the **Standard release (stable)** flow if cutting fresh, or the **Beta flow** promotion step if promoting an existing beta. Run the **Stable release (or promotion)** completion checklist at the bottom of that doc.

Do not cut a stable release while the macOS signing/notarization gate is active. For the first Reforged-owned feature, default to a patch-base increment; later releases follow the patch/minor classification in `docs/release.md`. Agents never select a major version autonomously.

The doc covers the changelog, pre-release sanity check, and post-release babysit pattern. Don't skip steps.
