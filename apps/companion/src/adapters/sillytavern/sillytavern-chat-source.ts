import type {
  LegacyChatListItem,
  LegacyChatLocator,
} from '@st-llm-rpg/wire';
import { canonicalJson, sha256 } from '../../modules/campaign/campaign-state.js';
import type {
  LegacyBindingMarker,
  LegacyChatSnapshot,
} from '../../modules/legacy-import/legacy-import-journal.js';
import {
  type LegacyChatSource,
} from '../../modules/legacy-import/legacy-import-service.js';

type ChatHeader = Record<string, unknown> & { chat_metadata?: Record<string, unknown> };
type RecentChat = Record<string, unknown> & {
  file_id?: unknown;
  file_name?: unknown;
  file_size?: unknown;
  chat_items?: unknown;
  last_mes?: unknown;
  avatar?: unknown;
  group?: unknown;
  chat_metadata?: unknown;
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function markerMatches(value: unknown, marker: LegacyBindingMarker): boolean {
  return canonicalJson(value) === canonicalJson(marker);
}

function contentWithoutBindingMarker(chat: readonly unknown[]): readonly unknown[] {
  const next = structuredClone(chat);
  const header = object(next[0]) as ChatHeader | null;
  const metadata = object(header?.chat_metadata);
  if (header && metadata) {
    const nextMetadata = structuredClone(metadata);
    delete nextMetadata.stLlmRpgBinding;
    if (Object.keys(nextMetadata).length === 0) delete header.chat_metadata;
    else header.chat_metadata = nextMetadata;
  }
  return next;
}

function sourceContentFingerprint(chat: readonly unknown[]): string {
  return sha256(contentWithoutBindingMarker(chat));
}

export class SillyTavernChatSource implements LegacyChatSource {
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  #csrfToken = '';
  #cookie = '';

  constructor(baseUrl: string, timeoutMs = 5_000) {
    this.#baseUrl = baseUrl.replace(/\/$/, '');
    this.#timeoutMs = timeoutMs;
  }

  async list(): Promise<readonly LegacyChatListItem[]> {
    const payload = await this.post('/api/chats/recent', { max: 10_000, pinned: [], metadata: true });
    if (!Array.isArray(payload)) throw new Error('SillyTavern recent chats response was not an array.');
    return payload.flatMap((raw): LegacyChatListItem[] => {
      const chat = object(raw) as RecentChat | null;
      const chatId = string(chat?.file_id);
      if (!chat || !chatId) return [];
      const groupId = string(chat.group);
      const avatar = string(chat.avatar);
      if (!groupId && !avatar) return [];
      const metadata = object(chat.chat_metadata);
      const envelope = metadata?.stLlmRpgCampaign;
      const campaign = object(object(envelope)?.campaign);
      const revision = Number(campaign?.revision);
      const locator: LegacyChatLocator = groupId
        ? { kind: 'group', chatId, groupId }
        : { kind: 'character', chatId, avatar };
      return [{
        locator,
        title: chatId,
        fileSize: string(chat.file_size),
        messageCount: Number.isInteger(Number(chat.chat_items)) ? Number(chat.chat_items) : 0,
        lastModified: typeof chat.last_mes === 'number' ? chat.last_mes : string(chat.last_mes) || 0,
        hasLegacyCampaign: envelope !== undefined,
        ...(Number.isInteger(revision) && revision >= 1 ? { legacyRevision: revision } : {}),
      }];
    });
  }

  async read(locator: LegacyChatLocator): Promise<LegacyChatSnapshot> {
    const chat = await this.readChat(locator);
    const header = object(chat[0]) as ChatHeader | null;
    if (!header) throw new Error('The saved chat header is not an object.');
    const metadata = object(header.chat_metadata) ?? {};
    return {
      locator,
      ...(metadata.stLlmRpgCampaign === undefined ? {} : { envelope: structuredClone(metadata.stLlmRpgCampaign) }),
      ...(metadata.stLlmRpgBinding === undefined ? {} : { bindingMarker: structuredClone(metadata.stLlmRpgBinding) }),
      sourceContentFingerprint: sourceContentFingerprint(chat),
      sourceState: structuredClone(chat),
    };
  }

  async writeMarker(snapshot: LegacyChatSnapshot, marker: LegacyBindingMarker) {
    const current = await this.read(snapshot.locator);
    if (current.sourceContentFingerprint !== snapshot.sourceContentFingerprint) {
      throw new Error('The saved chat changed after preview; marker overwrite was blocked.');
    }
    const chat = current.sourceState;
    if (!Array.isArray(chat) || chat.length === 0) throw new Error('The saved chat could not be prepared for marker write.');
    const header = object(chat[0]) as ChatHeader | null;
    if (!header) throw new Error('The saved chat header is not an object.');
    const metadata = object(header.chat_metadata) ?? {};
    const existing = metadata.stLlmRpgBinding;
    if (existing !== undefined && !markerMatches(existing, marker)) {
      throw new Error('The saved chat already contains a different Chat Binding marker.');
    }
    const hadLegacyBefore = metadata.stLlmRpgCampaign !== undefined;
    const legacyBefore = hadLegacyBefore ? canonicalJson(metadata.stLlmRpgCampaign) : '';
    const nextHeader: ChatHeader = {
      ...structuredClone(header),
      chat_metadata: { ...structuredClone(metadata), stLlmRpgBinding: marker },
    };
    const nextChat = [nextHeader, ...structuredClone(chat.slice(1))];
    if (!markerMatches(existing, marker)) await this.saveChat(snapshot.locator, nextChat);

    const readback = await this.readChat(snapshot.locator);
    const readbackMetadata = object(object(readback[0])?.chat_metadata);
    if (!readbackMetadata || !markerMatches(readbackMetadata.stLlmRpgBinding, marker)) {
      throw new Error('SillyTavern did not read back the expected Chat Binding marker.');
    }
    const hasLegacyAfter = readbackMetadata.stLlmRpgCampaign !== undefined;
    if (hasLegacyAfter !== hadLegacyBefore || (hadLegacyBefore && canonicalJson(readbackMetadata.stLlmRpgCampaign) !== legacyBefore)) {
      throw new Error('Legacy Campaign metadata changed during marker write; the Binding is blocked.');
    }
    if (sourceContentFingerprint(readback) !== snapshot.sourceContentFingerprint) {
      throw new Error('Saved chat content changed during marker write; the Binding is blocked.');
    }
    return { verified: true as const, legacyMetadataPreserved: true as const };
  }

  private async readChat(locator: LegacyChatLocator): Promise<unknown[]> {
    const payload = locator.kind === 'group'
      ? await this.post('/api/chats/group/get', { id: locator.chatId })
      : await this.post('/api/chats/get', {
          file_name: locator.chatId,
          avatar_url: locator.avatar,
          ch_name: locator.avatar.replace(/\.png$/i, ''),
        });
    if (!Array.isArray(payload) || payload.length === 0) throw new Error('SillyTavern returned an empty saved chat.');
    return payload;
  }

  private async saveChat(locator: LegacyChatLocator, chat: unknown[]): Promise<void> {
    const payload = locator.kind === 'group'
      ? await this.post('/api/chats/group/save', { id: locator.chatId, chat })
      : await this.post('/api/chats/save', {
          file_name: locator.chatId,
          avatar_url: locator.avatar,
          chat,
          force: false,
        });
    if (object(payload)?.ok !== true) throw new Error('SillyTavern rejected the Chat Binding marker save.');
  }

  private async ensureSession(): Promise<void> {
    if (this.#csrfToken) return;
    const response = await fetch(`${this.#baseUrl}/csrf-token`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (!response.ok) throw new Error(`SillyTavern CSRF session returned HTTP ${response.status}.`);
    const body = await response.json() as { token?: unknown };
    this.#csrfToken = string(body.token);
    const setCookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie') ?? ''];
    this.#cookie = setCookies.map(value => value.split(';', 1)[0]).filter(Boolean).join('; ');
    if (!this.#csrfToken) throw new Error('SillyTavern did not provide a CSRF token.');
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    await this.ensureSession();
    const response = await fetch(`${this.#baseUrl}${path}`, {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(this.#timeoutMs),
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-csrf-token': this.#csrfToken,
        ...(this.#cookie ? { cookie: this.#cookie } : {}),
      },
      body: JSON.stringify(body),
    });
    if (response.status === 403) {
      this.#csrfToken = '';
      this.#cookie = '';
    }
    if (!response.ok) throw new Error(`SillyTavern ${path} returned HTTP ${response.status}.`);
    return response.json();
  }
}
