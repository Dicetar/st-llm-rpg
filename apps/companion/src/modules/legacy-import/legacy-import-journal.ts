import type {
  ChatBindingDocument,
  LegacyChatLocator,
} from '@st-llm-rpg/wire';
import type { CampaignJournalAppend } from '../campaign/campaign-journal.js';

export type LegacyImportLookup = Readonly<{
  exact: ChatBindingDocument | null;
  sameContent: ChatBindingDocument | null;
  sameLocator: ChatBindingDocument | null;
}>;

export type LegacyCampaignImport = Readonly<{
  append: Extract<CampaignJournalAppend, { kind: 'create' }>;
  binding: ChatBindingDocument;
  locatorFingerprint: string;
  envelopeJson: string;
  legacyRevision: number;
  bindingEventId: string;
  bindingOperation: unknown;
}>;

export type LegacyBindingLink = Readonly<{
  requestId: string;
  campaignId: string;
  campaignRevision: number;
  binding: ChatBindingDocument;
  locatorFingerprint: string;
  envelopeJson: string;
  legacyRevision: number;
  bindingEventId: string;
  bindingOperation: unknown;
}>;

export type StoredLegacyImport = Readonly<{
  campaignId: string;
  campaignRevision: number;
  binding: ChatBindingDocument;
}>;

export type LegacyMarkerOutcome = Readonly<{
  bindingId: string;
  expectedRevision: number;
  state: 'verified' | 'blocked';
  problem?: string;
  eventId: string;
  requestId: string;
}>;

export interface LegacyImportJournal {
  lookupLegacyImport(sourceFingerprint: string, contentFingerprint: string, locatorFingerprint: string): Promise<LegacyImportLookup>;
  importLegacyCampaign(input: LegacyCampaignImport): Promise<StoredLegacyImport>;
  linkLegacyBinding(input: LegacyBindingLink): Promise<StoredLegacyImport>;
  readBinding(bindingId: string): Promise<ChatBindingDocument>;
  listBindings(campaignId: string): Promise<readonly ChatBindingDocument[]>;
  recordMarkerOutcome(input: LegacyMarkerOutcome): Promise<ChatBindingDocument>;
  backup(request: { destinationPath: string }): Promise<{ destinationPath: string }>;
  readCampaignRevision(campaignId: string): Promise<number>;
}

export type LegacyBindingMarker = Readonly<{
  schema: 'st-rpg.chat-binding-marker';
  version: '1.0';
  bindingId: string;
  campaignId: string;
}>;

export type LegacySourceMarkerResult = Readonly<{
  verified: true;
  legacyMetadataPreserved: true;
}>;

export type LegacyChatSnapshot = Readonly<{
  locator: LegacyChatLocator;
  envelope: unknown;
  sourceState?: unknown;
}>;
