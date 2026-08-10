import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { NarrationGenerationSchema } from './narration.js';

export * from './campaign.js';
export * from './context.js';
export * from './legacy-import.js';
export * from './narration.js';
export * from './story-sync.js';

export const WIRE_VERSION = '1.0' as const;
export const COMPANION_SERVICE = 'st-rpg-companion' as const;

const NonEmptyString = Type.String({ minLength: 1, maxLength: 512 });
const RequestId = Type.String({ minLength: 1, maxLength: 128 });
const Timestamp = Type.String({ minLength: 1, maxLength: 64 });

export const ProblemCodeSchema = Type.Union([
  Type.Literal('COMPANION_CONFIGURATION_INVALID'),
  Type.Literal('COMPANION_PORT_IN_USE'),
  Type.Literal('WORKSPACE_BUILD_MISSING'),
  Type.Literal('SQLITE_RUNTIME_UNAVAILABLE'),
  Type.Literal('DEPENDENCY_UNAVAILABLE'),
  Type.Literal('CAMPAIGN_NOT_FOUND'),
  Type.Literal('CAMPAIGN_RECORD_NOT_FOUND'),
  Type.Literal('CAMPAIGN_REVISION_NOT_FOUND'),
  Type.Literal('CAMPAIGN_VALIDATION_FAILED'),
  Type.Literal('CAMPAIGN_REVISION_CONFLICT'),
  Type.Literal('CAMPAIGN_REQUEST_CONFLICT'),
  Type.Literal('CAMPAIGN_HISTORY_CORRUPT'),
  Type.Literal('CAMPAIGN_STORE_UNAVAILABLE'),
  Type.Literal('SILLYTAVERN_CHAT_UNAVAILABLE'),
  Type.Literal('LEGACY_METADATA_NOT_FOUND'),
  Type.Literal('LEGACY_IMPORT_INVALID'),
  Type.Literal('LEGACY_IMPORT_STALE'),
  Type.Literal('LEGACY_IMPORT_COLLISION'),
  Type.Literal('CHAT_BINDING_NOT_FOUND'),
  Type.Literal('CONTEXT_CORE_OVER_BUDGET'),
  Type.Literal('CONTEXT_PINS_OVER_BUDGET'),
  Type.Literal('CONTEXT_STALE_PIN'),
  Type.Literal('CONTEXT_PRIVATE_PIN'),
  Type.Literal('CONTEXT_AUTHORITY_MISMATCH'),
  Type.Literal('CONTEXT_MODEL_PROFILE_MISSING'),
  Type.Literal('CONTEXT_MODEL_INCOMPATIBLE'),
  Type.Literal('CONTEXT_CANCELLED'),
  Type.Literal('NARRATION_EXCHANGE_INVALID'),
  Type.Literal('NARRATION_BRIDGE_INCOMPATIBLE'),
  Type.Literal('NARRATION_ROUTE_REJECTED'),
  Type.Literal('NARRATION_LOCATOR_MISMATCH'),
  Type.Literal('NARRATION_UPSTREAM_FAILED'),
  Type.Literal('NARRATION_OUTPUT_INVALID'),
  Type.Literal('NARRATION_CANCELLED'),
  Type.Literal('STORY_SYNC_ALREADY_PENDING'),
  Type.Literal('STORY_SYNC_SOURCE_EMPTY'),
  Type.Literal('STORY_SYNC_SOURCE_NOT_CONTIGUOUS'),
  Type.Literal('STORY_SYNC_SOURCE_PROOF_MISMATCH'),
  Type.Literal('STORY_SYNC_WORKER_MODEL_UNAVAILABLE'),
  Type.Literal('STORY_SYNC_OUTPUT_UNUSABLE'),
  Type.Literal('STORY_SYNC_JOB_NOT_FOUND'),
  Type.Literal('STORY_SYNC_PROPOSAL_NOT_FOUND'),
  Type.Literal('STORY_SYNC_PROPOSAL_REVISION_CONFLICT'),
  Type.Literal('STORY_SYNC_REVIEW_LOCKED'),
  Type.Literal('STORY_SYNC_REVIEW_INCOMPLETE'),
  Type.Literal('STORY_SYNC_FINALIZATION_STALE'),
  Type.Literal('NOT_FOUND'),
  Type.Literal('INTERNAL_ERROR'),
]);
export type ProblemCode = Static<typeof ProblemCodeSchema>;

export const RecoveryActionSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 64 }),
  label: Type.String({ minLength: 1, maxLength: 160 }),
  kind: Type.Union([
    Type.Literal('retry'),
    Type.Literal('open-url'),
    Type.Literal('run-command'),
    Type.Literal('inspect'),
  ]),
  target: Type.Optional(Type.String({ maxLength: 1024 })),
}, { additionalProperties: false });
export type RecoveryAction = Static<typeof RecoveryActionSchema>;

export const ProblemSchema = Type.Object({
  schema: Type.Literal('st-rpg.problem'),
  version: Type.Literal(WIRE_VERSION),
  code: ProblemCodeSchema,
  message: NonEmptyString,
  requestId: RequestId,
  retryable: Type.Boolean(),
  actions: Type.Array(RecoveryActionSchema, { maxItems: 8 }),
  details: Type.Optional(Type.Unknown()),
}, { $id: 'Problem', additionalProperties: false });
export type Problem = Static<typeof ProblemSchema>;

const NarrationStatusBase = {
  requestId: RequestId,
  route: Type.Union([Type.Literal('linked'), Type.Literal('unlinked'), Type.Literal('invalid')]),
  generation: Type.Union([NarrationGenerationSchema, Type.Null()]),
  bindingId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  startedAt: Timestamp,
};
const NarrationStatusFinished = {
  ...NarrationStatusBase,
  completedAt: Timestamp,
  elapsedMs: Type.Integer({ minimum: 0 }),
  httpStatus: Type.Integer({ minimum: 100, maximum: 599 }),
};
const { details: _narrationStatusDetails, ...NarrationStatusProblemProperties } = ProblemSchema.properties;
const NarrationStatusProblemSchema = Type.Object(NarrationStatusProblemProperties, { additionalProperties: false });

export const NarrationStatusRunningSchema = Type.Object({
  ...NarrationStatusBase,
  state: Type.Literal('running'),
}, { additionalProperties: false });
export type NarrationStatusRunning = Static<typeof NarrationStatusRunningSchema>;

export const NarrationStatusFinishedSchema = Type.Union([
  Type.Object({ ...NarrationStatusFinished, state: Type.Literal('completed') }, { additionalProperties: false }),
  Type.Object({ ...NarrationStatusFinished, state: Type.Literal('cancelled') }, { additionalProperties: false }),
  Type.Object({ ...NarrationStatusFinished, state: Type.Literal('rejected'), problem: NarrationStatusProblemSchema }, { additionalProperties: false }),
  Type.Object({ ...NarrationStatusFinished, state: Type.Literal('failed'), problem: NarrationStatusProblemSchema }, { additionalProperties: false }),
]);
export type NarrationStatusFinished = Static<typeof NarrationStatusFinishedSchema>;

export const NarrationStatusDocumentSchema = Type.Object({
  schema: Type.Literal('st-rpg.narration-status'),
  version: Type.Literal(WIRE_VERSION),
  observedAt: Timestamp,
  active: Type.Array(NarrationStatusRunningSchema, { maxItems: 16 }),
  latest: Type.Union([NarrationStatusFinishedSchema, Type.Null()]),
}, { $id: 'NarrationStatusDocument', additionalProperties: false });
export type NarrationStatusDocument = Static<typeof NarrationStatusDocumentSchema>;

export const ComponentIdSchema = Type.Union([
  Type.Literal('workspace'),
  Type.Literal('sqlite-runtime'),
  Type.Literal('sillytavern'),
  Type.Literal('lm-studio'),
]);
export type ComponentId = Static<typeof ComponentIdSchema>;

export const ComponentStatusSchema = Type.Union([
  Type.Literal('ready'),
  Type.Literal('available'),
  Type.Literal('degraded'),
  Type.Literal('unavailable'),
  Type.Literal('not-configured'),
]);
export type ComponentStatus = Static<typeof ComponentStatusSchema>;

export const ComponentObservationSchema = Type.Object({
  id: ComponentIdSchema,
  status: ComponentStatusSchema,
  blocking: Type.Boolean(),
  message: NonEmptyString,
  observedAt: Timestamp,
  latencyMs: Type.Optional(Type.Number({ minimum: 0 })),
}, { additionalProperties: false });
export type ComponentObservation = Static<typeof ComponentObservationSchema>;

export const HealthDocumentSchema = Type.Object({
  schema: Type.Literal('st-rpg.health'),
  version: Type.Literal(WIRE_VERSION),
  service: Type.Literal(COMPANION_SERVICE),
  status: Type.Literal('alive'),
  requestId: RequestId,
  startedAt: Timestamp,
  uptimeMs: Type.Integer({ minimum: 0 }),
}, { $id: 'HealthDocument', additionalProperties: false });
export type HealthDocument = Static<typeof HealthDocumentSchema>;

export const ReadinessDocumentSchema = Type.Object({
  schema: Type.Literal('st-rpg.readiness'),
  version: Type.Literal(WIRE_VERSION),
  service: Type.Literal(COMPANION_SERVICE),
  ready: Type.Boolean(),
  status: Type.Union([
    Type.Literal('ready'),
    Type.Literal('degraded'),
    Type.Literal('not-ready'),
  ]),
  requestId: RequestId,
  observedAt: Timestamp,
  components: Type.Array(ComponentObservationSchema, { minItems: 4, maxItems: 4 }),
}, { $id: 'ReadinessDocument', additionalProperties: false });
export type ReadinessDocument = Static<typeof ReadinessDocumentSchema>;

export function isProblem(value: unknown): value is Problem {
  return Value.Check(ProblemSchema, value);
}

export function isHealthDocument(value: unknown): value is HealthDocument {
  return Value.Check(HealthDocumentSchema, value);
}

export function isReadinessDocument(value: unknown): value is ReadinessDocument {
  return Value.Check(ReadinessDocumentSchema, value);
}
