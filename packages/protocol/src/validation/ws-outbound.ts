import type { z } from "zod";
import {
  SessionOutboundShard0,
  SessionOutboundShard1,
  SessionOutboundShard10,
  SessionOutboundShard11,
  SessionOutboundShard12,
  SessionOutboundShard13,
  SessionOutboundShard14,
  SessionOutboundShard15,
  SessionOutboundShard2,
  SessionOutboundShard3,
  SessionOutboundShard4,
  SessionOutboundShard5,
  SessionOutboundShard6,
  SessionOutboundShard7,
  SessionOutboundShard8,
  SessionOutboundShard9,
  WSPong,
} from "../generated/validation/ws-outbound.aot.js";
import { WSOutboundMessageSchema as SourceWSOutboundMessageSchema } from "../messages.js";
import type { WSOutboundMessage } from "../messages.js";
import { getSessionOutboundValidatorShardIndex } from "./ws-outbound-shards.js";

type WSOutboundValidationResult =
  | { success: true; data: WSOutboundMessage }
  | { success: false; error: z.ZodError };

interface WSOutboundGeneratedValidator {
  safeParse(input: unknown): WSOutboundValidationResult;
}

/** Holds the generated top-level pong validator */
const wsPongValidator = WSPong as WSOutboundGeneratedValidator;

/** Holds one generated validator for each bounded session message shard */
const sessionOutboundValidators = [
  SessionOutboundShard0,
  SessionOutboundShard1,
  SessionOutboundShard2,
  SessionOutboundShard3,
  SessionOutboundShard4,
  SessionOutboundShard5,
  SessionOutboundShard6,
  SessionOutboundShard7,
  SessionOutboundShard8,
  SessionOutboundShard9,
  SessionOutboundShard10,
  SessionOutboundShard11,
  SessionOutboundShard12,
  SessionOutboundShard13,
  SessionOutboundShard14,
  SessionOutboundShard15,
] as WSOutboundGeneratedValidator[];

/** Narrows an unknown value to a property-bearing record */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Chooses the small generated validator for a structurally routable outbound frame */
function getGeneratedValidator(input: unknown): WSOutboundGeneratedValidator | undefined {
  if (!isRecord(input)) {
    return undefined;
  }

  if (input.type === "pong") {
    return wsPongValidator;
  }

  if (
    input.type !== "session" ||
    !isRecord(input.message) ||
    typeof input.message.type !== "string"
  ) {
    return undefined;
  }

  const shardIndex = getSessionOutboundValidatorShardIndex(input.message.type);
  return shardIndex === undefined ? undefined : sessionOutboundValidators[shardIndex];
}

/** Validates outbound frames with a bounded AOT shard and preserves source-schema errors for malformed input */
export function validateWSOutboundMessage(input: unknown): WSOutboundValidationResult {
  const validator = getGeneratedValidator(input);
  return validator ? validator.safeParse(input) : SourceWSOutboundMessageSchema.safeParse(input);
}
