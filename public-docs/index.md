---
title: Getting started
description: Install Paseo and start running coding agents from anywhere.
nav: Getting started
order: 1
category: Getting started
---

# Getting started

Paseo runs your coding agents on your machine and gives you a mobile, desktop, web, and CLI client to drive them from anywhere. Three common ways to install.

## Desktop app (recommended)

Download from the [GitHub releases page](https://github.com/staoran/paseo-reforged/releases). Open it and you're done.

The desktop app bundles its own daemon and starts it automatically, no separate install required. On first launch you'll see a brief startup screen, then connect from your phone using **Settings → your host → Connections → Pair a device**.

## Server / CLI

For headless machines, dev boxes, or any setup where you want the daemon running without the desktop UI:

Paseo Reforged does not publish npm packages yet. This installs the upstream Paseo CLI as a compatibility option; it follows upstream releases and does not receive Reforged betas.

```bash
npm install -g @getpaseo/cli
paseo
```

Paseo prints a QR code in the terminal. Scan it from a compatible mobile app, or enter the daemon address manually from another client. Use the GitHub desktop release when you need the Reforged build itself.

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

- [Docker](/docs/docker), run the daemon and bundled web UI in a container.
- [Workspaces](/docs/workspaces), the project, workspace, and session model Paseo is built around.
- [Providers](/docs/providers), what a provider is and how Paseo wraps existing CLIs.
- [Orchestration](/docs/orchestration), let one agent delegate work to other providers and models.
- [CLI reference](/docs/cli), every command.
- [Self-hosting the web UI](/docs/web-ui), serve the browser app from your own daemon.
- [GitHub repo](https://github.com/staoran/paseo-reforged)
- [Report an issue](https://github.com/staoran/paseo-reforged/issues)

## Prerequisites

Paseo manages other agents, it doesn't ship one. Before it's useful, install at least one provider CLI yourself and make sure it works with your credentials. See [Supported providers](/docs/supported-providers) for the full list.

You'll also want the [GitHub CLI](https://cli.github.com/) (`gh`) installed and authenticated, Paseo uses it for PR-aware worktrees and a few orchestration features.
