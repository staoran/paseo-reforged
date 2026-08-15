# Paseo Reforged release

All workspaces share one version and release together.

## Current fork policy

- Releases target `https://github.com/staoran/paseo-reforged.git`; `release:push` refuses any other exact `origin` URL.
- The three-number SemVer base always tracks the adopted upstream Paseo version; Reforged does not claim the next upstream patch or minor number.
- Reforged validation releases use `X.Y.Z-beta.N`. `N` is the public beta release ordinal on that upstream base, not a Git commit count, and resets to `1` when the adopted upstream base changes.
- If immutable same-base beta tags already exist in the local tag namespace, `release:beta:next` starts after the highest occupied ordinal instead of deleting, moving, or reusing a tag.
- The future Reforged formal channel uses `X.Y.Z-reforged.N`, with the same reset rule. This is technically a SemVer prerelease, so the parser, updater ordering, and stable workflows must gain explicit Reforged-channel support before this naming policy can be published as a formal release.
- npm and GHCR publishing are disabled. `release:check` still performs npm pack dry runs, and `docker.yml` remains a non-publishing build check.
- Beta GitHub releases may include explicitly unsigned/non-notarized macOS artifacts. Stable releases are blocked locally and in CI until macOS signing and notarization credentials are configured; enabling stable requires intentionally removing both gates.
- App Store, Play Store, and Cloudflare deployment are independent credential gates and are not part of the first GitHub beta completion contract.
- Release tags are immutable. Never move or force-push an existing release tag; fix the code and cut the next beta or version.

## Two steps

A release has exactly two steps. The agent does the first, the user authorizes the second.

**Preparation** (local, reversible — agent does this):

- format, lint, typecheck all green
- ACP provider catalog drift checked with `npm run acp:version-drift:check`;
  if stale package-runner pins are intentional, say so explicitly, otherwise run
  `npm run acp:version-drift:update` and commit the updated catalog
- re-check the adopted upstream base version, apply the fork version policy above,
  then show the target version and rationale to the user
- draft the changelog, show it to the user, wait for review
- run the pre-release sanity check, surface findings to the user
- confirm CI is green

**Go-ahead** (user says "go ahead"):

- commit the approved changelog
- run the release

Rules that apply to both steps:

- Last-minute changes always need approval. Every time.
- No code changes bundled into the changelog commit or the release commit. Code shims live in their own commit, reviewed on their own merits.
- A sanity-check finding is information, not a directive. The agent surfaces it; the user decides.
- Invoking a release skill is intent to start the flow, not blanket authorization to publish.
- If the user asks for a release preview, show the prospective changelog/release contents and answer questions, but do not commit, tag, publish, or run release commands until they explicitly authorize the release.

## Two paths

There are two supported ways to ship from `main`:

1. **Direct stable release**: you are ready to ship the current `main` commit to everyone immediately.
2. **Beta flow**: release candidates on the `beta` channel. Betas carry an in-place changelog entry and never move the website download target off the latest stable.

The beta flow is the only currently enabled publishing path. Stable is a documented future path gated by macOS signing/notarization.

## Release version decision

First determine the exact three-number SemVer of the adopted upstream revision.
That `X.Y.Z` remains the base for every Reforged release until a newer upstream
version is adopted.

For beta releases, use `X.Y.Z-beta.N`:

- From a stable upstream base `X.Y.Z`, `release:beta:next` starts `X.Y.Z-beta.1`.
- From `X.Y.Z-beta.N`, the same command produces `X.Y.Z-beta.(N+1)`.
- If same-base `vX.Y.Z-beta.N` tags already occupy later ordinals, the command advances past the highest occupied ordinal.
- `N` counts public beta releases on that base. It does not count Git commits.
- Adopting a new upstream base resets the next beta to `beta.1`.

The reserved formal-channel format is `X.Y.Z-reforged.N`. `N` counts public
Reforged formal releases on the same upstream base and resets when the upstream
base changes. For example, the first formal release on upstream `0.2.5` is
`0.2.5-reforged.1`; after adopting upstream `0.2.6`, it is
`0.2.6-reforged.1`.

`reforged.N` is syntactically a SemVer prerelease and sorts below bare `X.Y.Z`.
The current release parser, promotion command, GitHub stable gate, and Electron
stable updater do not yet implement the product-level formal-channel semantics.
Do not publish this format until all of those paths are updated and verified.
The fork does not independently increment the upstream patch, minor, or major
components.

Version bumps are never used to retry a failed build. Retry the existing version
as described in **Fixing a failed release build**.

## Standard release (stable)

Stable publishing is currently blocked. Do not run a stable release command
until macOS signing/notarization is configured and the stable gate in
`.github/workflows/desktop-release.yml` is intentionally removed or replaced by
credential-backed signing.

The adopted stable-channel target is `X.Y.Z-reforged.N`, but no current stable
release command produces or fully supports that format. Before enabling stable,
add explicit parser, tag metadata, changelog sync, GitHub release, Electron
updater, and version-command support for the Reforged formal channel. The
existing `release:patch`, `release:minor`, and `release:promote` commands remain
blocked and must not be used as substitutes.

Before running any stable release command:

- Make sure the intended release commit is already committed to `main` and the working tree is clean.
- **Run `npm run format`, `npm run lint`, and `npm run typecheck` and commit any resulting changes BEFORE you start any `release:*` command.** `release:check` runs `npm install --workspaces --include-workspace-root` as part of `release:prepare`, which can mutate `package-lock.json` (e.g. churning `"dev": true` markers on optional deps). The next step, `version:all:*`, runs `npm version` which aborts when the working tree is dirty. If this happens mid-flight you have to commit the lockfile churn before retrying — and the pre-commit format hook will reject a lockfile-only commit because oxfmt internally skips `package-lock.json` while lefthook's glob still matches it. Avoid the whole mess by running format/lint/typecheck first, then `release:prepare` once on its own to absorb any lockfile churn into a normal commit, then start the release.
- Do not use a release command as a substitute for checking whether the current commit is actually ready.

After both the Reforged formal-channel support and stable gates are intentionally
completed, the future stable command must update all workspaces and atomically
push the branch plus immutable tag to `staoran/paseo-reforged`. The tag push is
expected to trigger `Desktop Release`, `Android APK Release`, and
`Release Notes Sync`. npm and Docker publishing remain disabled; EAS store
submission remains separately gated.

The Docker workflow only performs non-publishing source-build checks on pull requests, `main`, or manual dispatch. Release tags never publish Docker images.

The production relay is the Elixir service in [getpaseo/paseo-relay](https://github.com/getpaseo/paseo-relay), with its own deployment process. Paseo releases and pushes to this repository do not deploy it. The Cloudflare relay code and workflow in this repository are legacy and are not used in production.

**Stable means stable.** If the user says "stable" or "ship stable", do not ask whether they want a beta first. They picked stable; treat it as a direct stable release. Only run the beta flow when the user explicitly says "beta".

## Manual stable release

There is no supported manual stable sequence yet. Do not compose one from the
blocked legacy version modes; add and verify a dedicated Reforged formal-channel
flow when the stable prerequisites are implemented.

## Beta flow

```bash
npm run release:beta:next        # Stable X.Y.Z -> X.Y.Z-beta.1
# ... test desktop and APK prerelease assets from GitHub Releases ...
npm run release:beta:next        # X.Y.Z-beta.N -> X.Y.Z-beta.(N+1)
```

- Beta tags are published GitHub prereleases like `v0.1.41-beta.1`
- Betas publish desktop assets and APKs for testing, but they do not trigger the production web/mobile release flows. The website exposes available Reforged prerelease assets behind its Beta channel selector without advertising npm, Homebrew, store, or hosted Web channels that the fork does not publish.
- A future formal release uses a fresh tag like `v0.2.5-reforged.1`; it never reuses the beta tag
- Desktop assets now come from the Electron package at `packages/desktop`
- Beta releases use Electron's `beta` update channel. Users on the stable channel only receive stable releases; users on the beta channel receive beta releases and the final stable release when it is published.
- Same-base beta versions sort below bare `X.Y.Z`. A client already running `X.Y.Z` will not automatically downgrade to `X.Y.Z-beta.1`; install that first beta manually. Once on the beta line, later `beta.N` ordinals update in increasing order.
- **Betas carry a changelog entry.** Beta users read release notes, so each beta updates an in-place `CHANGELOG.md` entry (`## X.Y.Z-beta.N`) that `Release Notes Sync` mirrors into the prerelease body on the tag push. Once the formal-channel tooling exists, that release overwrites the entry in place with `## X.Y.Z-reforged.N`, so no `-beta.N` heading is left behind. See the Changelog policy section.

Use the beta path when you need to:

- smoke a build yourself before promoting it to everyone
- test a build manually in a Linux or Windows VM
- send a build to a user who is hitting a specific problem
- iterate on `beta.1`, `beta.2`, `beta.3`, and so on before deciding to ship broadly

## Staged rollout (stable channel)

Stable desktop releases go out via a linear time-based rollout for automatic update checks: 0% admitted when the updater manifests appear, 100% admitted 36 hours later, linear ramp in between. Manual checks bypass the rollout so a user can install immediately when they click **Check**. Beta releases bypass the rollout entirely — beta users always receive updates immediately.

This section records the required rollout behavior for the future Reforged formal
channel. It is not currently executable; the examples assume the dedicated
`X.Y.Z-reforged.N` release flow and updater support have been implemented.

The rollout is driven by a `rolloutHours` field stamped into the GitHub Release manifests (`latest-mac.yml`, `latest-linux.yml`, `latest.yml`) by the `finalize-rollout` job in `desktop-release.yml`.

Desktop release builds now publish in two phases:

- Platform build jobs upload the installers/packages (`.dmg`, `.zip`, `.exe`, `.AppImage`, etc.) to the GitHub release.
- The final job merges/stamps the manifests and uploads all `.yml` files only after they already contain the final `releaseDate` and `rolloutHours`.

Updater clients only discover a release through those `.yml` manifests, so there is no silent 100% admission window before rollout metadata is present.

### Default behavior

Future Reforged formal release command -> tag push -> 36h ramp. No extra action
is expected after the dedicated command exists.

The `rollout_hours` input on `desktop-release.yml` is **only read on `workflow_dispatch`** — tag-push runs always default to 36. To get any other rollout duration on a fresh release, use the post-publish flip below.

### Instant-admit release (rollout_hours=0 from publish)

For a fresh release that should admit everyone immediately (low-risk change, doc-only, hotfix, or just a release you want out fast), cut the release normally and queue the rollout flip immediately after:

```bash
# After the future formal release command pushes the tag, immediately queue the flip.
gh workflow run desktop-rollout.yml \
  -f tag=v0.2.5-reforged.1 \
  -f rollout_hours=0
```

**Why this is gap-free:** `desktop-release.yml`'s `finalize-rollout` job and `desktop-rollout.yml` share the concurrency group `desktop-rollout-<tag>`. Dispatching `desktop-rollout.yml` while the tag-push pipeline is still running queues it safely behind `finalize-rollout`. The first public manifests already carry `rolloutHours=36`, then `desktop-rollout.yml` flips them to `rolloutHours=0` shortly afterward. The renderer polls every 30 minutes, so active stable users pick up the new manifest on their next check.

Run the dispatch right after the future dedicated formal release command returns. Don't wait for the tag-push CI to finish.

### Adjusting an already-published release

To change the rollout duration on a release that's already shipped — e.g. flip a hotfix to instant admit, or slow a release down — use the dedicated `desktop-rollout.yml` workflow. It edits the manifests in place on the GitHub release without rebuilding anything. It only rewrites `rolloutHours`; `releaseDate` is preserved, so the rollout clock keeps ticking from the original publish time.

**Hotfix (instant admit) on an already-shipped release:**

```bash
gh workflow run desktop-rollout.yml \
  -f tag=v0.2.5-reforged.1 \
  -f rollout_hours=0
```

`rollout_hours=0` admits 100% of stable users on their next update check (within ~30 min for active clients).

**Slow a rollout down** (e.g. extend total duration to 72h since the original release):

```bash
gh workflow run desktop-rollout.yml \
  -f tag=v0.2.5-reforged.1 \
  -f rollout_hours=72
```

`rollout_hours` is **total duration since the original release date**, not "extend by N more hours from now." If `v0.1.42` was published 2h ago and you set `rollout_hours=72`, the ramp finishes 70h from now.

The dispatch is idempotent and shares the `desktop-rollout-<tag>` concurrency group with `desktop-release.yml`'s `finalize-rollout` job, so it serializes safely against an in-flight tag-push pipeline targeting the same release.

### Custom ramp on a manually-dispatched build

`desktop-release.yml` accepts `rollout_hours` only on `workflow_dispatch`, which is the path used to **rebuild an existing tag** (retry a failed release, force a rebuild on a different ref). When you go that route, you can stamp a non-default ramp directly:

```bash
gh workflow run desktop-release.yml \
  -f tag=v0.2.5-reforged.1 \
  -f rollout_hours=6
```

This does **not** apply to a fresh formal release tag push, which must stamp 36
hours by default once the dedicated flow exists. For a fresh release with a
custom ramp, cut normally and then dispatch `desktop-rollout.yml` using the same
pattern as the instant-admit flow above, with the chosen `rollout_hours`.

### Releasing during an active rollout

If you ship N+1 while N is still ramping, N+1 starts a fresh rollout from its own publish timestamp. N's rollout effectively ends — the newer manifest supersedes it. Rollout-aware clients revalidate the manifest for up to five seconds before installing a downloaded update on quit. If N+1 has replaced N but the client is not admitted to N+1 yet, it skips the downloaded N and waits rather than installing two updates in succession. If revalidation times out, the app exits without installing the cached update.

If `reforged.(N+1)` fixes a bug in `reforged.N`, dispatch `desktop-rollout.yml -f tag=vX.Y.Z-reforged.<N+1> -f rollout_hours=0` after it publishes so users who already got `reforged.N` reach the fix quickly.

### Limitations

- **No pause / kill switch.** To stop new admissions, ship a superseding release. Clients revalidate on quit and will not install the superseded download, but a client that already completed installation cannot be recalled; ship the next Reforged formal ordinal.
- **No rollback.** `allowDowngrade = false`. Bad release = ship a hotfix.
- **Bootstrap caveat.** Clients running a build older than the rollout feature ignore `rolloutHours` and admit immediately. Rollout protection only applies to clients running the rollout-aware version or later.
- **Up to ~30 min automatic admission latency.** Renderer polls every 30 minutes, so a stable user may take up to that long to be evaluated against the rollout window. Clicking **Check** is manual and bypasses rollout admission.

## Mobile builds (EAS)

The Reforged Expo project is owned by `tao-team`, uses slug
`paseo-reforged`, and has project ID
`5e4527ba-abbd-428f-8a56-300c21b9e1af`. Effective Expo config consumes that
ID through `EAS_PROJECT_ID`. The development and production EAS build profiles
provide it to remote builders, while `.github/workflows/android-apk-release.yml`
uses the matching repository variable for its local preflight and skips when
that variable is absent. Keep both values identical.

- **Android APK (current beta contract)** — `.github/workflows/android-apk-release.yml` builds `sh.paseo.reforged` and attaches `Paseo-Reforged-<tag>-android.apk` to the GitHub prerelease.
- **Android Play Store** — blocked until a `sh.paseo.reforged` Play listing and submission credentials exist.
- **iOS TestFlight/App Store** — blocked until a `sh.paseo.reforged` App Store Connect listing and signing/submission credentials exist. The removed upstream `ascAppId` must not be restored.

EAS uses the local app version source. `packages/app/app.config.js` derives
Android `versionCode` as `major * 1_000_000 + minor * 1_000 + patch`. iOS
reserves 1,000 build slots per app version: beta `N` uses slot `N`, and stable
uses slot `999`. For example, `0.3.0-beta.4` uses iOS build number `3000004`.
Rebuilding the same tag produces the same native build number; if a store has
already accepted a binary and a different binary is required, cut the next beta
instead of relying on remote auto-increment. Reforged store submission remains
blocked by the credential and listing gates above.

### Watching mobile builds from the terminal

Use the EAS CLI from `packages/app/`:

```bash
cd packages/app

# Recent builds (newest first). Pipe to jq for status only.
npx eas build:list --limit 8 --non-interactive --json | jq '.[] | {platform, status, appVersion, gitCommitHash}'

# Recent EAS workflow runs, when a build workflow is enabled.
npx eas workflow:runs --json | jq '.[] | {status, workflowName, trigger, gitCommitHash, startedAt, finishedAt}'

# Filter by platform.
npx eas build:list --platform ios --limit 5 --non-interactive --json
npx eas build:list --platform android --limit 5 --non-interactive --json

# Inspect a specific build.
npx eas build:view <build-id>

# Inspect a workflow run.
npx eas workflow:view <workflow-run-id> --json

# Read failed submit/review job logs.
npx eas workflow:logs <workflow-job-id> --all-steps --non-interactive

# Stream logs for a build.
npx eas build:view <build-id> --json | jq '.logFiles[]'
```

A build's `gitCommitHash` must match the immutable release tag commit. `status`
walks through `NEW` → `IN_QUEUE` → `IN_PROGRESS` → `FINISHED` (or
`ERRORED`/`CANCELED`). When store workflows are later enabled, build success is
not submission success; App Store Connect and Play Console remain the final
ground truth.

## Release notes on GitHub

The GitHub Release body is populated automatically by the `Release Notes Sync` workflow (`.github/workflows/release-notes-sync.yml`). It triggers on every `v*` tag push and on any push to `main` that touches `CHANGELOG.md`, then runs `scripts/sync-release-notes-from-changelog.mjs` to mirror the matching changelog entry into the release body. You don't need to write release notes on GitHub manually — keep `CHANGELOG.md` correct and the workflow will sync it. To force a re-sync, dispatch the workflow with the tag input.

For tag pushes, the current fork workflow accepts beta tags only. Bare
`vX.Y.Z` tags are blocked, and `vX.Y.Z-reforged.N` is not yet accepted by the
release parser. The Reforged formal channel remains unavailable until its
version/update semantics and the stable signing and deployment gates are all
implemented.

## Website behavior

- The website download page defaults to the latest published **stable** release from `staoran/paseo-reforged`.
- A published Reforged beta prerelease is available behind the Stable/Beta switch on `/download` (`?channel=beta`) and never becomes the default. The switch appears only when the newest prerelease leads stable on its core version.
- The Beta view contains only assets actually attached to the Reforged GitHub release. npm, Homebrew, App Store, Play Store, and hosted Web rows remain hidden until the fork configures and publishes those channels.
- The download target only moves when a future `vX.Y.Z-reforged.N` release is published as a non-prerelease after formal-channel support is implemented.
- The public `/changelog` page renders `CHANGELOG.md` as-is, so the in-flight `-beta.N` entry shows there once it lands on `main` — that's intended, it's where beta users check what's coming. Only the **download target** stays pinned to the latest stable; the download links read GitHub's releases API, not the changelog, so a `-beta.N` heading on top never affects them.
- The source website reads releases from `staoran/paseo-reforged`. Cloudflare deployment is not part of the release contract until fork-owned account/project credentials are configured.

## Fixing a failed release build

Release tags are immutable. A transient CI or infrastructure failure may be
retried for the same tag without changing source. If source, configuration, or
packaging code must change, commit the fix and cut the next beta ordinal (or the
next Reforged formal ordinal after that channel is enabled); never move the existing tag or overwrite it with
`--force`.

`workflow_dispatch` is appropriate for a workflow-only fix or a transient
rebuild. Keep `checkout_ref` on the immutable tag so produced binaries still
correspond to that tag. It is not a way to smuggle newer application code into
an old release.

Docker publishing is disabled. To re-run its source-build check:

```bash
gh workflow run docker.yml \
  --ref main \
  -f paseo_version=X.Y.Z-beta.N
```

For a transient desktop retry, dispatch the existing immutable tag:

```bash
gh workflow run desktop-release.yml \
  --ref main \
  -f tag=v0.2.0-beta.2 \
  -f checkout_ref=v0.2.0-beta.2
```

For a source fix after `v0.2.0-beta.2`, update the changelog and cut
`v0.2.0-beta.3`. `release:push` deliberately refuses a local or remote tag that
already points elsewhere.

## Notes

- `version:all:*` bumps root + syncs workspace versions and `@getpaseo/*` dependency versions
- `release:prepare` refreshes workspace `node_modules` links to prevent stale types
- `npm run dev:desktop` and `npm run build:desktop` target the Electron desktop package in `packages/desktop`
- The website uses GitHub's latest published release API for download links, so published beta prereleases do not replace the stable download target.

## Changelog format

Release notes depend on the changelog heading format. The heading **must** be strictly followed:

```
## X.Y.Z - YYYY-MM-DD
## X.Y.Z-beta.N - YYYY-MM-DD
## X.Y.Z-reforged.N - YYYY-MM-DD
```

No prefix (`v`), no extra text. `Release Notes Sync` matches the heading for the pushed tag to extract the version. `X.Y.Z-reforged.N` is reserved for the future formal channel and is not accepted by the current parser yet. A malformed or unsupported heading breaks the release-notes sync for that tag.

## Changelog policy

- `CHANGELOG.md` includes stable releases and the current beta line.
- The first beta of a version inserts a top entry like `## 0.1.60-beta.1 - YYYY-MM-DD`.
- Each subsequent beta updates that same top entry in place — bump the heading (`0.1.60-beta.1` → `0.1.60-beta.2`) and fold in whatever else landed.
- A future formal release updates that same entry in place one last time: heading from `X.Y.Z-beta.N` to `X.Y.Z-reforged.N`, date to the formal release day.
- One entry per version line. The `-beta.N` heading is intermediary — overwrite it, never append. Don't leave stale `-beta.N` entries behind and don't create a duplicate entry per beta.
- It always covers the full diff from the previous stable tag, regardless of how many betas were cut in between.

## Changelog ownership

- **The agent running the release writes the changelog entry — beta or stable.** Do not hand the changelog to another model or agent. The release agent has the release context and owns the final wording.
- **Commit history is only an index of the changes. Never draft the changelog from commit subjects or diffs alone.** For every PR in the release range, read the full PR description and every issue it links to before deciding what changed, why users care, or how changes should be grouped. Use the implementation only to verify the resulting understanding.
- Draft or refresh the entry from the previous-stable-to-`HEAD` range, review it against the changelog policy below, show it to the user, and wait for approval before committing it. Each beta refreshes the same entry; a future formal release refreshes it one last time from that full range.

## Changelog wording

The changelog is shown in Paseo Reforged release surfaces. Write each bullet as a compact factual record of changed product behavior for **end users**, not developers.

- **Name the exact change.** Prefer `Added <capability>`, `Removed <behavior>`,
  `Changed <behavior>`, or `Fixed <failure> when <condition>`.
- **Keep the scope exact.** A conditional bug is not a general reliability problem. Do not
  broaden one failure into claims that Paseo is now faster, smoother, responsive, or reliable.
- **Use concrete product and runtime terms.** Git polling, persisted cache, provider catalog,
  and WebSocket reconnects can identify the affected behavior. Component names, internal
  modules, code symbols, and implementation techniques cannot: omit `WorkingIndicator`,
  `reconcileAndEmitWorkspaceUpdates`, remounts, memoization, and controlled inputs.
- **State the consequence only when the change itself is unclear.** Keep the condition that
  makes the consequence true. Do not replace a precise change with a broad benefit claim.
- **Do not invent context.** Mention an upgrade, platform, workload, or user action only when
  the PR or linked issue establishes that scope.

| Avoid                                                        | Write                                                 |
| ------------------------------------------------------------ | ----------------------------------------------------- |
| Paseo stays responsive with many idle Git workspaces         | Removed periodic Git polling for idle workspaces      |
| Incompatible saved app data no longer crashes after upgrades | Fixed crash when persisted cache was incompatible     |
| Splitting layouts no longer remounts the active agent        | Fixed scroll position resetting when splitting a pane |
| Mobile model selector is faster and more straightforward     | Added search to the mobile model selector             |

Test each bullet against the source PR and issue: can a reviewer point to the exact behavior
that changed, the failure that was fixed, or the capability that was added? If the bullet only
claims a general improvement, rewrite it with the concrete change.

- **Collapse internal iterations.** If a feature was added and then fixed within the same release, just list the feature as working. Users never saw the broken version.
- **Only list changes relative to the previous stable release.** The diff is `v(previous)..HEAD`. If something was introduced and fixed between those two tags, it never shipped — don't mention the fix.
  - **Common trap:** when drafting from `git log`, every commit looks like a separate bullet — including the "fix X" commits that landed on top of a brand-new feature in the same release window. Before listing a Fixed entry, check whether the thing being fixed was itself added in this same release. If so, drop the fix and fold it into the feature bullet.
  - **Example:** if the release adds an in-app browser and also contains a commit "fix: browser pane keyboard handling no longer steals shortcuts", do **not** list the keyboard fix under Fixed. The browser is shipping for the first time, so users will only ever see the working version. The Added entry covers it.
- **Cut low-signal entries.** "Toolbar buttons have consistent sizing" is too granular. Combine small polish items or drop them.

## Changelog conciseness

Every bullet must be scannable at a glance. The changelog is not release documentation — it's a list.

- **One sentence per bullet, max.** If a bullet contains two sentences, the second one is doing work that belongs in product docs, not the changelog. Cut it.
- **No trailing periods.** Bullets are list items, not prose. Drop the period at the end of every bullet, including the period inside any bolded lead-in. `**Configurable terminal scrollback**` not `**Configurable terminal scrollback.**`.
- **One line per bullet.** If a bullet wraps to three lines in a narrow column, it's too long.
- **Split bullets that pack multiple distinct changes.** If a bullet uses "and", "plus", a comma list, or an em-dash to chain several independent improvements, break them into separate bullets — even when they share a theme or author. One bullet = one user-facing change.
- **Trim qualifying clauses.** Drop "with a hint shown when…", "matching the CLI's behaviour", "across common install shapes". If the detail doesn't change whether a user cares, cut it.
- **Stop after identifying the change.** Do not explain LAN/WAN topology, TLS handshakes, IPC, or other architecture in a changelog bullet. Put necessary background in product docs.
- **Attribution follows the split.** When you split a dense bullet, move each PR/author to the bullet it belongs to. Never duplicate the same PR across multiple bullets.

## Changelog attribution

Every changelog bullet must credit contributors and link to the PR(s) that delivered the change. This is not one-PR-per-line — a single bullet describes a user-facing change and may reference multiple PRs.

Format: append `([#123](https://github.com/staoran/paseo-reforged/pull/123) by [@user](https://github.com/user))` at the end of each bullet. For changes spanning multiple PRs or contributors:

```markdown
- Voice mode now works on tablets with proper microphone permissions. ([#210](https://github.com/staoran/paseo-reforged/pull/210), [#215](https://github.com/staoran/paseo-reforged/pull/215) by [@alice](https://github.com/alice), [@bob](https://github.com/bob))
```

Rules:

- **Always link the PR number** as `[#N](https://github.com/staoran/paseo-reforged/pull/N)`.
- **Always link the contributor's GitHub profile** as `[@user](https://github.com/user)`.
- **One bullet = one user-facing change**, regardless of how many PRs went into it. Group related PRs on the same bullet.
- **De-duplicate contributors.** If the same person authored multiple PRs in one bullet, list them once.
- **Only credit external contributors.** Skip attribution for [@boudra](https://github.com/boudra). The changelog credits community contributions — core team work is the default.
- **Credit the commit author, not the PR opener.** A maintainer often opens a PR that lands work authored by someone else (cherry-pick, rebase of a contributor's branch, manual extraction from a stacked PR). The squash commit preserves the original commit's author, but `gh pr view N --json author` returns the PR opener — using that field will silently mis-credit the work to the maintainer (and then the "skip @boudra" rule drops the attribution entirely). Always resolve attribution from commit authors.

  Use this command to get the GitHub logins for each PR:

  ```bash
  gh pr view N --json commits --jq '[.commits[].authors[].login] | unique | .[]'
  ```

  This returns every distinct GitHub login that authored or co-authored a commit in the PR. Use those logins for attribution. Fall back to `gh pr view N --json author` only if the commits command returns nothing (which should not happen for merged PRs).

  When listing PR numbers, `git log --format='%H %s' v<previous>..HEAD | grep -E '\(#[0-9]+\)$'` pulls the PR number out of squash commit subjects.

## Changelog ordering

Entries within each section (Added, Improved, Fixed) are ordered by user impact:

1. **User-facing features and changes first** — things users will notice, want to try, or that change their workflow.
2. **Quality-of-life improvements** — polish, performance, smoother interactions.
3. **Internal/infra changes last** — only include if they have a tangible user benefit (e.g. "faster startup" is user-facing even if the fix was internal).

## Pre-release sanity check

Before cutting a **stable** release, the release agent reviews the diff as a last line of defence against shipping bugs. Skip this for betas — the beta itself is the smoke test, and gating each beta on a code review defeats the point of using betas as fast release candidates.

Review the diff between the latest release tag and `HEAD`. Focus on:

1. **Breaking changes** — especially in the WebSocket protocol, agent lifecycle, and any server↔client contract.
2. **Backward compatibility** — the important direction is old app clients talking to newly updated daemons. Users update desktop and daemon first, then keep running the old app for a while. Flag anything that breaks old clients against new daemons or requires both sides to update in lockstep.
3. **Regressions** — anything that looks like it could break existing functionality.

Use `git diff <latest-release-tag>..HEAD` as the review input. This is a deep sanity check, not a full code review. If anything looks risky, investigate before proceeding and surface the finding to the user.

## Changelog scope

The changelog always covers **previous-stable-to-`HEAD`**, beta and stable alike:

- **Beta release**: the entry covers `previous stable tag → HEAD`. Update the current in-place beta entry; don't start a fresh one per beta.
- **Formal release**: the same entry is updated in place to `X.Y.Z-reforged.N`. It still captures the full delta from the previous formal release, not just what changed since the last beta.

Betas are checkpoints along the way; the entry is the single record for the jump from one stable version to the next, and beta users read it in the meantime.

## Completion checklist

### Beta release

- [ ] Working tree is clean and the intended commit is on `main`
- [ ] `origin` is exactly `https://github.com/staoran/paseo-reforged.git`
- [ ] Every PR in the previous-stable-to-`HEAD` range has been opened, and its full description and every linked issue have been read before drafting the changelog
- [ ] Update the in-place beta entry in `CHANGELOG.md` (heading `## X.Y.Z-beta.N - YYYY-MM-DD`), review it against the changelog policy, get approval, and commit it before cutting the release
- [ ] The adopted upstream base version is re-checked; the target follows the current fork policy and is approved
- [ ] Release preparation stayed local until the approved release command pushed the complete branch and tag
- [ ] `npm run release:beta:next` completes successfully
- [ ] GitHub `Desktop Release` workflow for the `v*-beta.N` tag is green
- [ ] GitHub `Android APK Release` workflow for the same tag is green
- [ ] GitHub `Release Notes Sync` mirrored the beta entry into the prerelease body
- [ ] Docker was not published and npm packages were not published
- [ ] macOS assets, if present, are explicitly described as unsigned/non-notarized

### Stable release (or promotion)

- [ ] Dedicated `X.Y.Z-reforged.N` parser, version command, GitHub release, Electron updater, and changelog-sync support is implemented and verified
- [ ] macOS signing and notarization credentials are configured and the stable workflow gate has been intentionally replaced by credential-backed signing
- [ ] Run the pre-release sanity check (see above) and address any findings
- [ ] The adopted upstream base and next Reforged formal ordinal are re-checked, with the target version and rationale approved
- [ ] Every PR in the previous-stable-to-`HEAD` range has been opened, and its full description and every linked issue have been read before drafting the changelog
- [ ] Ensure the intended release commit is already committed and the git worktree is clean before running any release command
- [ ] Ensure local `npm run typecheck` passes on that exact commit before running any release command
- [ ] Update `CHANGELOG.md` with user-facing release notes (features, fixes — not refactors). Overwrite the existing `## X.Y.Z-beta.N` heading in place with `## X.Y.Z-reforged.N` and the formal release date; do not add a duplicate entry
- [ ] Verify the changelog heading follows strict `## X.Y.Z-reforged.N - YYYY-MM-DD` format
- [ ] The future dedicated Reforged formal release command completes successfully
- [ ] GitHub `Desktop Release` workflow for the `v*` tag is green
- [ ] GitHub `Android APK Release` workflow for the same tag is green
- [ ] npm and Docker publishing remained disabled

### Store submission (separate gate)

- [ ] New App Store Connect and Play Console listings exist for `sh.paseo.reforged`
- [ ] The user explicitly included store submission in the release scope
- [ ] EAS `Release Mobile` workflow for the same tag is green
- [ ] EAS iOS `build_ios` completes for the same tag
- [ ] EAS iOS `submit_ios` succeeds, uploading the build to App Store Connect/TestFlight
- [ ] EAS iOS `submit_ios_for_review` succeeds, putting the build into App Store review
- [ ] EAS Android `build_android` completes for the same tag
- [ ] EAS Android `submit_android` succeeds, putting the build on its Play Store track
