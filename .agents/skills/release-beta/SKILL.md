---
name: release-beta
description: Cut a beta release of Paseo Reforged. Use when the user says "release beta", "cut a beta", "ship a beta", "beta release", or "/release-beta". Betas carry an in-place changelog entry and do not publish npm or Docker images.
user-invocable: true
---

# Release beta

Read `docs/release.md` and follow the **Beta flow** section end-to-end. Run the **Beta release** completion checklist at the bottom of that doc.

During preparation, classify the previous-stable-to-`HEAD` diff as patch or minor and show the target version and rationale to the user. Agents never select a major version autonomously.

During the initial fork phase, re-check the upstream base SemVer and use `release:beta:next` to increment only `-beta.N`. The first Paseo Reforged-owned feature defaults to a patch-base increment. Each beta updates the in-place `CHANGELOG.md` entry, and release tags are immutable.
