import { z } from "zod";
import { SessionOutboundMessageSchema } from "../messages.js";

/** Sets the fixed number of independently compiled session validator shards */
export const SESSION_OUTBOUND_VALIDATOR_SHARD_COUNT = 16;

type SessionOutboundMessageOption = (typeof SessionOutboundMessageSchema.options)[number];

/** Reads the literal session message type from one discriminated-union option */
function getSessionOutboundMessageType(option: SessionOutboundMessageOption): string {
  const messageType = option.shape.type.value;
  if (typeof messageType !== "string") {
    throw new Error("Session outbound message options must have a string type literal");
  }
  return messageType;
}

/** Assigns a type to a stable shard without depending on declaration order */
function getStableShardIndex(messageType: string): number {
  let hash = 0;

  for (let index = 0; index < messageType.length; index += 1) {
    hash = (Math.imul(hash, 31) + messageType.charCodeAt(index)) >>> 0;
  }

  return hash % SESSION_OUTBOUND_VALIDATOR_SHARD_COUNT;
}

/** Creates a discriminated union for a non-empty validator shard */
function createSessionOutboundShardSchema(options: SessionOutboundMessageOption[]) {
  const [firstOption, ...remainingOptions] = options;
  if (!firstOption) {
    throw new Error("Session outbound validator shards must not be empty");
  }

  return z.discriminatedUnion("type", [firstOption, ...remainingOptions]);
}

/** Groups session responses so Hermes compiles several bounded factories instead of one giant one */
const sessionOutboundOptionsByShard = Array.from(
  { length: SESSION_OUTBOUND_VALIDATOR_SHARD_COUNT },
  () => [] as SessionOutboundMessageOption[],
);

for (const option of SessionOutboundMessageSchema.options) {
  const messageType = getSessionOutboundMessageType(option);
  sessionOutboundOptionsByShard[getStableShardIndex(messageType)]?.push(option);
}

/** Exposes generated-schema roots and their deterministic message-type membership */
export const sessionOutboundValidationShards = sessionOutboundOptionsByShard.map(
  (options, index) => {
    const messageSchema = createSessionOutboundShardSchema(options);

    return {
      index,
      messageTypes: options.map(getSessionOutboundMessageType),
      schema: z.object({ type: z.literal("session"), message: messageSchema }),
    };
  },
);

/** Resolves a known message type to the generated validator shard that owns it */
export function getSessionOutboundValidatorShardIndex(messageType: string): number | undefined {
  const shardIndex = getStableShardIndex(messageType);
  const shard = sessionOutboundValidationShards[shardIndex];

  return shard?.messageTypes.includes(messageType) ? shardIndex : undefined;
}

/** Returns a generated-schema root while making invalid static shard indexes fail loudly */
export function getSessionOutboundValidationShard(index: number) {
  const shard = sessionOutboundValidationShards[index];
  if (!shard) {
    throw new Error(`Missing session outbound validator shard ${index}`);
  }
  return shard;
}
