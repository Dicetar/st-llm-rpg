import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

export const NARRATION_EXCHANGE_HEADER = 'x-st-rpg-exchange' as const;
export const NARRATION_EXCHANGE_PROTOCOL = 'st-rpg.narration' as const;
export const PINNED_SILLYTAVERN_REVISION = '380e31e8c58d196969b6a0da74f431ba999c7e0a' as const;
export const MAX_NARRATION_EXCHANGE_BYTES = 4 * 1024;

const Identifier = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
});
const UuidV4 = Type.String({
  pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
});
const Revision = Type.String({ minLength: 40, maxLength: 40, pattern: '^[0-9a-f]{40}$' });
const LocatorText = Type.String({ minLength: 1, maxLength: 512 });

export const NarrationChatLocatorSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('character'),
    ownerId: LocatorText,
    chatId: LocatorText,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('group'),
    ownerId: LocatorText,
    chatId: LocatorText,
  }, { additionalProperties: false }),
]);
export type NarrationChatLocator = Static<typeof NarrationChatLocatorSchema>;

const LocatorSchema = Type.Object({
  version: Type.Literal(1),
  hostId: Identifier,
  chat: NarrationChatLocatorSchema,
}, { additionalProperties: false });

const BridgeSchema = Type.Object({
  version: Type.String({ minLength: 1, maxLength: 64 }),
  sillyTavernRevision: Revision,
}, { additionalProperties: false });

const LinkedNarrationExchangeSchema = Type.Object({
  protocol: Type.Literal(NARRATION_EXCHANGE_PROTOCOL),
  version: Type.Literal(1),
  requestId: UuidV4,
  route: Type.Object({
    kind: Type.Literal('linked'),
    bindingId: Identifier,
  }, { additionalProperties: false }),
  generation: Type.Union([
    Type.Literal('normal'),
    Type.Literal('regenerate'),
    Type.Literal('continue'),
    Type.Literal('swipe'),
  ]),
  locator: LocatorSchema,
  bridge: BridgeSchema,
}, { additionalProperties: false });

const UnlinkedNarrationExchangeSchema = Type.Object({
  protocol: Type.Literal(NARRATION_EXCHANGE_PROTOCOL),
  version: Type.Literal(1),
  requestId: UuidV4,
  route: Type.Object({ kind: Type.Literal('unlinked') }, { additionalProperties: false }),
  generation: Type.Union([
    Type.Literal('normal'),
    Type.Literal('regenerate'),
    Type.Literal('continue'),
    Type.Literal('swipe'),
    Type.Literal('quiet'),
    Type.Literal('impersonate'),
  ]),
  locator: LocatorSchema,
  bridge: BridgeSchema,
}, { additionalProperties: false });

export const NarrationExchangeSchema = Type.Union([
  LinkedNarrationExchangeSchema,
  UnlinkedNarrationExchangeSchema,
]);
export type NarrationExchange = Static<typeof NarrationExchangeSchema>;

export class NarrationExchangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NarrationExchangeError';
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function assertExchange(value: unknown): asserts value is NarrationExchange {
  if (!Value.Check(NarrationExchangeSchema, value)) {
    throw new NarrationExchangeError('The value does not match the narration exchange contract.');
  }
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function decodeBase64Url(value: string): Uint8Array {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/') + padding);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

export function encodeNarrationExchange(value: NarrationExchange): string {
  assertExchange(value);
  const bytes = new TextEncoder().encode(canonicalJson(value));
  if (bytes.byteLength > MAX_NARRATION_EXCHANGE_BYTES) {
    throw new NarrationExchangeError('The narration exchange exceeds the 4 KiB decoded limit.');
  }
  return `v1.${encodeBase64Url(bytes)}`;
}

export function decodeNarrationExchange(value: string): NarrationExchange {
  if (!value.startsWith('v1.')) {
    throw new NarrationExchangeError('The narration exchange version is missing or unsupported.');
  }
  const encoded = value.slice(3);
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new NarrationExchangeError('The narration exchange payload is not unpadded base64url.');
  }
  if (encoded.length > Math.ceil(MAX_NARRATION_EXCHANGE_BYTES * 4 / 3)) {
    throw new NarrationExchangeError('The narration exchange exceeds the 4 KiB decoded limit.');
  }
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64Url(encoded);
  } catch {
    throw new NarrationExchangeError('The narration exchange payload is not valid base64url.');
  }
  if (bytes.byteLength > MAX_NARRATION_EXCHANGE_BYTES) {
    throw new NarrationExchangeError('The narration exchange exceeds the 4 KiB decoded limit.');
  }
  if (encodeBase64Url(bytes) !== encoded) {
    throw new NarrationExchangeError('The narration exchange payload is not canonical base64url.');
  }
  let json: string;
  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new NarrationExchangeError('The narration exchange payload is not valid UTF-8.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new NarrationExchangeError('The narration exchange payload is not valid JSON.');
  }
  if (canonicalJson(parsed) !== json) {
    throw new NarrationExchangeError('The narration exchange JSON is not canonical.');
  }
  assertExchange(parsed);
  return parsed;
}

export function readNarrationExchangeHeader(rawHeaders: readonly string[]): string {
  const values: string[] = [];
  for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === NARRATION_EXCHANGE_HEADER) values.push(rawHeaders[index + 1]!);
  }
  if (values.length === 0) throw new NarrationExchangeError('The narration exchange header is missing.');
  if (values.length !== 1) throw new NarrationExchangeError('The narration exchange header must appear exactly once.');
  return values[0]!;
}
