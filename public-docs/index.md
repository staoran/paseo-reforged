---
title: Getting started
description: Install Paseo Reforged and start running coding agents from anywhere.
nav: Getting started
order: 1
category: Getting started
---

# Getting started

Paseo Reforged runs coding agents on your machine and provides desktop, Android, self-hosted web, and CLI surfaces to drive them from anywhere.

## Desktop app (recommended)

Download from the [GitHub releases page](https://github.com/staoran/paseo-reforged/releases). Open it and you're done.

The desktop app bundles its own daemon and starts it automatically, no separate install required. On first launch you'll see a brief startup screen, then connect from your phone using **Settings → your host → Pair Device**.

## Server / CLI

For headless machines, dev boxes, or any setup where you want the daemon running without the desktop UI:

```bash
nix run github:staoran/paseo-reforged
```

The Reforged daemon starts locally, then asks whether to enable the end-to-end encrypted relay and print a pairing QR code. If you decline, enter the daemon address manually over TCP, Tailscale, or another VPN.

### Upstream npm compatibility

Paseo Reforged does not publish npm packages yet. This installs the upstream Paseo CLI as a compatibility option; it follows upstream releases and does not receive Reforged betas.

```bash
npm install -g @getpaseo/cli
paseo
```

The upstream CLI has its own release cadence. Use the Reforged desktop assets or Nix command when you need the Reforged build itself.

The daemon can also serve the browser web app itself, so you can use the full UI without the hosted app. See [Self-hosting the web UI](/docs/web-ui).

Configuration and local state live under `PASEO_HOME` (defaults to `~/.paseo`).

## Docker

Paseo Reforged does not publish an image yet. For compatibility testing on
servers, dev boxes, NAS devices, or homelab hosts, use the upstream image:

```bash
docker run -d --name paseo \
  -p 6767:6767 \
  -e PASEO_PASSWORD=change-me \
  -v "$PWD/paseo-home:/home/paseo" \
  -v "$PWD:/workspace" \
  ghcr.io/getpaseo/paseo:latest
```

Then open `http://localhost:6767`.

The image runs the daemon and serves the bundled web UI. It does not bundle agent CLIs, so extend it with the agents you use. See [Docker](/docs/docker) for Compose, reverse proxy, agent install, and security examples.

## Where next

- [Connectivity](/docs/connectivity), connect through the relay or Tailscale.
- [Docker](/docs/docker), use the upstream compatibility image for the daemon and bundled web UI.
- [Workspaces](/docs/workspaces), the project, workspace, and session model Paseo is built around.
- [Providers](/docs/providers), what a provider is and how Paseo wraps existing CLIs.
- [Orchestration](/docs/orchestration), let one agent delegate work to other providers and models.
- [CLI reference](/docs/cli), every command.
- [Self-hosting the web UI](/docs/web-ui), serve the browser app from your own daemon.
- [GitHub repo](https://github.com/staoran/paseo-reforged)
- [Report an issue](https://github.com/staoran/paseo-reforged/issues)

## Prerequisites

Paseo Reforged manages other agents; it doesn't ship one. Before it's useful, install at least one provider CLI yourself and make sure it works with your credentials. See [Supported providers](/docs/supported-providers) for the full list.

You'll also want the [GitHub CLI](https://cli.github.com/) (`gh`) installed and authenticated, Paseo uses it for PR-aware worktrees and a few orchestration features.
