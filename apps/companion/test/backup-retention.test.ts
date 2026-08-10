import test from 'node:test';
import assert from 'node:assert/strict';
import type { BackupDocument } from '@st-llm-rpg/wire';
import { retainedBackupIds } from '../src/modules/operations/backup-service.js';

const verification = {
  verified: true as const,
  verifiedAt: '2026-08-10T00:00:00.000Z',
  durationMs: 1,
  campaignCount: 1,
};

function backup(id: string, kind: BackupDocument['kind'], createdAt: string): BackupDocument {
  return {
    schema: 'st-rpg.backup', version: '1.0', id, kind, createdAt,
    fileName: `${id}.sqlite`, sizeBytes: 1024, sha256: id.padEnd(64, 'a').slice(0, 64),
    availability: 'available', verification,
  };
}

test('backup retention preserves manual backups, recent sets, weekly anchors, and unavailable evidence', () => {
  const now = new Date('2026-08-10T12:00:00.000Z');
  const daily = Array.from({ length: 70 }, (_, index) => backup(
    `daily-${index}`,
    'daily',
    new Date(now.getTime() - index * 24 * 60 * 60 * 1_000).toISOString(),
  ));
  const preOperation = Array.from({ length: 45 }, (_, index) => backup(
    `preop-${index}`,
    'pre-operation',
    new Date(now.getTime() - index * 2 * 24 * 60 * 60 * 1_000).toISOString(),
  ));
  const manual = backup('manual-old', 'explicit', '2025-01-01T00:00:00.000Z');
  const missing = { ...backup('missing-old', 'daily', '2025-01-02T00:00:00.000Z'), availability: 'missing' as const };

  const keep = retainedBackupIds([...daily, ...preOperation, manual, missing], now);

  daily.slice(0, 14).forEach(entry => assert.equal(keep.has(entry.id), true));
  assert.equal(keep.has('daily-15'), true);
  assert.equal(keep.has('daily-69'), false);
  preOperation.slice(0, 20).forEach(entry => assert.equal(keep.has(entry.id), true));
  assert.equal(keep.has('preop-30'), false);
  assert.equal(keep.has(manual.id), true);
  assert.equal(keep.has(missing.id), true);
});
