# Protocol Validation

The client validates inbound WebSocket messages with a zod-aot generated validator instead of runtime Zod on the hot path. Zod remains the authoring source of truth for schemas and TypeScript types.

The reason is mobile performance. A captured 353 KB provider snapshot cost about 10.9 ms and 5.9 MB allocated per message for `JSON.parse` plus Zod on Hermes. After moving provider-model normalization out of the schema so zod-aot could compile the hot subtree, the generated validator path measured about 2.5 ms and 1.2 MB allocated.

## Runtime Path

`packages/protocol/src/validation/ws-outbound.ts` is the shipped boundary. It calls the generated `WSOutboundMessageSchema.safeParse` and returns the validated data. It does not normalize, repair, or re-validate the generated result.

Generated validators preserve unknown keys where Zod object parsing strips them. The client dispatch path uses known `type` and payload fields, so this passthrough behavior is accepted for inbound messages. The wire format is unchanged.

Provider model normalization is a parser-side compatibility shim in the client consumers that need it. Newer daemons normalize at the provider registry source.

## Additive compatibility boundaries

Wire schemas declare both the beta.5 agent configuration fields (`approvalPolicy`, `sandboxMode`,
`networkAccess`, `webSearch`, and provider-specific `extra`) and the canonical
`providerOptions`/`toolPolicy` fields as optional. The schema layer does not choose between them.
After structural validation, the server compatibility module resolves both representations at the
Agent creation/resume boundary. Equal values merge; conflicting, ambiguous, invalid, or unsupported
legacy mappings fail before a provider session starts. The same dual-read shape is retained for
stored Agent and Schedule records so normal reads do not erase either representation.

New clients must not rely on unknown-field stripping when sending policy-bearing configuration to
an older daemon. `server_info.features.agentProviderOptions` and `agentToolPolicy` gate Agent create
and Schedule create/update requests. If the required feature is absent, the client fails before
sending the frame. Old clients remain valid because all canonical fields and feature flags are
additive and optional.

Hub v1 create responses retain `error: string | null`; `errorDetails` is an optional passthrough
object for structured diagnostics. Consumers must accept string-only responses and unknown detail
keys. Hub v2 request/response literals are not implemented by this repository; exact literal
agreement, no-fallback selection, and real Cloud interoperability remain cross-repository release
requirements.

## Codegen Ownership

The protocol package owns generation.

- `packages/protocol/codegen/ws-outbound.compile.ts` is the build-time zod-aot discovery entry.
- `packages/protocol/scripts/generate-validation-aot.mjs` runs the exact-pinned compiler and applies the small local compiler patches before generation.
- `packages/protocol/scripts/watch-validation-aot.mjs` reruns generation while editing protocol sources.
- `packages/protocol/src/generated/validation/ws-outbound.aot.ts` is generated runtime code and is gitignored.
- `packages/protocol/src/validation/ws-outbound-schema-metadata.ts` is runtime schema metadata for zod-aot fallback/default references.

Generation runs from protocol-owned lifecycle hooks: `prebuild`, `pretypecheck`, `pretest`, and `watch`. Installs do not run generation: published packages consume protocol from prebuilt `dist`, and local build/typecheck/test flows generate the source file at the point it is actually needed.

## Regression Tests

zod-aot is exact-pinned and young enough that compiler patches are treated as part of this package. `packages/protocol/tests/validation/ws-outbound.test.ts` keeps small regression tests for the patched cases:

- discriminated-union branch output must propagate `.default()` fields
- current sequential item routing must accept `tool_call`-like status branches
- generated runtime imports must keep `.js` extensions for packaged Node ESM
- the generated WebSocket envelope accepts a minimal valid message and rejects a corrupted one
- old/new Agent and Hub frames retain additive optional fields and string-error compatibility

## Schema Purity

Message schemas are structural declarations. Do not put `.transform()`, `.catch()`, or `.preprocess()` on WebSocket message schemas. If parsed data needs normalization, put it in an explicit consumer or post-validation pass.

Use `z.discriminatedUnion()` when every branch has a shared literal tag. Plain `z.union()` is acceptable only when there is no shared literal discriminator or when a generated-code regression test proves that specific shape is miscompiled.

Defaults are allowed only on primitive leaves. Do not place `.default()` on large arrays, item schemas, or big containers in inbound message schemas.

## Timeline summary/detail compatibility

`server_info.features.agentTimelineSummaryDetail` is the single capability gate for the stored
timeline projection fast path. Supporting clients may add optional `projectionRequest` to the
existing `fetch_agent_timeline_request` and consume optional `projectionPayload` from the existing
response. These fields do not replace the ordinary `projection`, entries, cursor, or paging
envelope. Clients connected to an older daemon omit the request and use the canonical bounded-tail
path; newer clients continue to accept responses without a projection payload as an ordinary
eligibility miss or compatibility fallback.

The projection payload is a discriminated union of `summary` and `activity_detail`. Detail errors
stay inside the detail payload so retry state remains local to one Activity; transport/schema
failures still use the surrounding RPC error behavior. The optional fields retain their dated
`COMPAT(agentTimelineSummaryDetail)` markers until the registered removal date.
