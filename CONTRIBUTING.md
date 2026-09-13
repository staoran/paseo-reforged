# Contributing to Paseo Reforged

Thank you for taking the time to contribute to Paseo Reforged.

## Philosophy

Paseo Reforged is an independently maintained fork of [upstream Paseo](https://github.com/getpaseo/paseo), built on freedom and flexibility: any agent provider, any device, running on your own machine. It is meant to be composable, so you can build the workflow you want. Read more about the product vision [here](docs/product.md).

Given Paseo Reforged's scope, contributing to it takes a lot of context that is very hard to transfer. That's why product, design, architecture, and workflow decisions are currently all made by the maintainer.
This guide is here to save us both time and help you find a useful way to contribute.

Paseo grows through bug reports, testing, workflow discussions, plugins, documentation, and people helping each other. The sections below explain where each contribution belongs and what to expect.

## Philosophy

**Paseo has a lean, opinionated core built to be extended.**

The goal is a low floor and a high ceiling: a polished default experience that is easy to understand, with the flexibility to choose your providers, run on your own infrastructure, and build your own workflows. Paseo should remain self-hosted and respectful of your privacy and control.

The core continues to evolve through improvements to the shared experience. Specialized workflows and integrations belong in the extension ecosystem. Product, design, architecture, and workflow decisions remain with the maintainer.

## Report Reforged bugs in GitHub issues

Open an [issue in the Paseo Reforged repository](https://github.com/staoran/paseo-reforged/issues).
Read the [product philosophy](docs/product.md) for the reasoning behind these choices and how Paseo develops.

## Build a plugin

Most specialized workflows and integrations are better served by plugins.

Plugins let you build what you need, share it, and maintain it independently. Start with the [plugin documentation](https://paseo.sh/docs/plugins). For applications and integrations built around Paseo, see the [SDK documentation](https://paseo.sh/docs/sdk).

If an extension point is missing, describe the workflow in [Discussions](https://github.com/getpaseo/paseo/discussions). A reusable capability that enables several plugins may be a better addition than implementing one particular workflow in core.

## Product discussions

Paseo Reforged does not currently have a dedicated Discussions surface or feature request backlog. Ideas that also apply to upstream Paseo can be discussed in [upstream Discussions](https://github.com/getpaseo/paseo/discussions) or the upstream `#product` channel in [Discord](https://discord.gg/jz8T2uahpH). Those channels belong to upstream and do not create a Reforged commitment. Frame the discussion as a workflow:

- What are you trying to do?
- How do you do it today?
- Where does Paseo Reforged get in the way?
- What would the flow look like if it worked for you?

This helps other people describe their needs and gives me useful context when deciding what to build.

There is no feature request backlog or commitment to implement a discussion. I may read and learn from it without replying.

## If you still want to submit a pull request

After considering plugins and discussing the workflow, you may still want to propose a change to core. Focused fixes for reproducible bugs are also welcome.

**Pull requests are closed by default.** I may reopen the ones I want to take forward. Submit one only if you are comfortable with it being closed without a detailed review or explanation.

Paseo receives more pull requests than I can responsibly review. Reviewing every submission and explaining every decision would consume the time available for developing the product.

I can prompt an agent to write code just as you can. The bottlenecks are choosing what to build, shaping it, verifying its behavior, and taking responsibility for its maintenance. A finished implementation still leaves that work to do.

If you choose to submit a PR, these are the basics to cover.

### What I look for in a core feature

- **Demonstrated demand.** Link a discussion with concrete examples of other users needing the workflow. A feature for a small, specialized use case belongs in a plugin.
- **Value across workflows.** The feature should improve how existing capabilities work together and benefit a broad set of users. A reusable improvement is more valuable than an isolated control for one task.
- **A coherent design across platforms and providers.** Shared capabilities should work across platforms and providers wherever applicable. Do not reshape a shared abstraction around one provider while leaving the others unsupported or inconsistent.
- **A finished experience.** Follow the [design guidelines](docs/design.md). The feature must look and feel right in Paseo, including loading states, layout stability, and interaction performance. PRs with janky or rushed interfaces will be closed. Design judgment remains with the maintainer.

### Keep the scope small

Submit one focused change. PRs adding more than roughly **3,000 lines of production code** are unlikely to be accepted. Prefer the smallest complete improvement that can be tested and understood on its own.

### QA evidence

Run the changed application or service and test the affected workflow yourself. Include detailed QA evidence so I can see what you exercised and what happened. PRs without this verification and evidence will be closed, whether they fix a bug or add a feature.

Explain the problem and link the relevant bug report or discussion. Include:

- Automated tests that exercise the changed behavior. A bug fix needs a regression test that fails on the broken version.
- The commands you ran and their output.
- A recording for interactive UI changes, or before-and-after screenshots for static changes.
- The platforms you tested and any affected platforms you could not test.

The [QA guide](docs/qa.md) explains the expected evidence and available tooling.

Using an agent is welcome. Sending it to implement a change and submitting its output without trying the result yourself does not meet this bar.

**Satisfying all of the above does not mean your pull request will be merged.**

### What happens to your contribution

If I take a contribution forward, I may narrow it, reshape it, or use it as a reference for my own implementation. **You will be credited for your contribution, including when I reimplement it.**

A closed PR does not necessarily mean the underlying problem was dismissed. It means I am not taking that submission forward. Detailed reviews, individual explanations, and follow-up discussions cannot be provided at this volume.

## Help the community

Testing betas, reproducing bugs, improving documentation, sharing plugins, and answering questions all help Paseo develop.

For a Reforged bug, open a [GitHub issue](https://github.com/staoran/paseo-reforged/issues). For upstream Paseo questions, use the [upstream Discord](https://discord.gg/jz8T2uahpH).

### Should I use GitHub or Discord?

Use GitHub for Paseo Reforged bugs. The linked Discord is operated by upstream Paseo, not Paseo Reforged.

### Why was my feature request closed?

Issues are only for bugs. If the idea also applies upstream, open an upstream product discussion framed as a workflow; that does not create a Reforged commitment.

### Why didn't my PR get a detailed review?

Writing a review is very time consuming and Paseo receives a lot of PRs, I cannot give detailed explanations at volume.

### How long until someone looks at my pull request?

It depends on what else is going on. QA takes longer than reading the diff.

### Why do you want tests and a video for a small change?

Because it's faster and safer than me checking out and running every PR myself to test it manually.

QA evidence help me take your PR seriously for a deeper review and maintainer QA.

### I only have one platform, can I still contribute?

Yes. Test what you have, and say what you didn't test.

### Can I use an agent to write my contribution?

Yes, as long as you understand what you're submitting and you tested it yourself.

### Is there a roadmap I can read?

[docs/product.md](docs/product.md) covers the direction. There's no public list of what I'm building next.
There is no formal process for becoming a maintainer. Consistent involvement and good judgment build the shared context needed to take on more responsibility.
