# Protocol Validator Codegen

This directory is build-time only. `ws-outbound.compile.ts` is the zod-aot discovery entry for the inbound WebSocket validator.

The generated index is written to `../src/generated/validation/ws-outbound.aot.ts`, with independently compiled session validator modules under `../src/generated/validation/ws-outbound/`. The generated files are not committed. Splitting keeps Hermes from compiling the full session union in one factory while the runtime routes each known message type to its matching AOT validator.

`zod-aot` is exact-pinned, and the protocol generator applies the small compiler patches it requires before generation. Treat changes to those patches like compiler changes: regenerate, inspect the output, and run the protocol validation regression tests before shipping.
