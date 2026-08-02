---
name: release-beta
description: Cut a beta release of Paseo Reforged. Use when the user says "release beta", "cut a beta", "ship a beta", "beta release", or "/release-beta". Betas carry an in-place changelog entry and do not publish npm or Docker images.
user-invocable: true
---

# Release beta

Read `docs/release.md` and follow the **Beta flow** section end-to-end. Run the **Beta release** completion checklist at the bottom of that doc.

During preparation, re-check the adopted upstream `X.Y.Z` base and show the target version and rationale to the user. Reforged beta releases keep that three-number base and use `X.Y.Z-beta.N`; `N` is the public beta ordinal on the base, not a Git commit count, and resets when a newer upstream base is adopted.

Use `release:beta:next` both to start `X.Y.Z-beta.1` from stable `X.Y.Z` and to increment an existing `X.Y.Z-beta.N`. Do not claim the next upstream patch or minor version. Each beta updates the in-place `CHANGELOG.md` entry, and release tags are immutable.

Call out the same-base ordering constraint before release: `X.Y.Z-beta.1` sorts below bare `X.Y.Z`, so clients already on `X.Y.Z` need a manual first-beta install. Later beta ordinals can update normally from that beta line.
