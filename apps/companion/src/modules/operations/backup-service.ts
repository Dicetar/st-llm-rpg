import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { Value } from '@sinclair/typebox/value';
import {
  BackupDocumentSchema,
  type BackupCatalog,
  type BackupDocument,
  type BackupKind,
  type CampaignVerificationResult,
  type RestoreBackupPreview,
  type RestoreBackupReceipt,
} from '@st-llm-rpg/wire';
import type { CampaignJournal } from '../campaign/campaign-journal.js';
import { CampaignExpectedError } from '../campaign/campaign-error.js';

const DAILY_CHECK_INTERVAL_MS = 60 * 60 * 1_000;

function checksum(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const input = createReadStream(path);
    input.on('data', chunk => hash.update(chunk));
    input.once('error', reject);
    input.once('end', () => resolveHash(hash.digest('hex')));
  });
}

function restoreToken(backup: BackupDocument): string {
  return createHash('sha256').update(JSON.stringify({
    id: backup.id,
    sha256: backup.sha256,
    sizeBytes: backup.sizeBytes,
  })).digest('hex');
}

function utcDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function utcWeekStart(value: Date): number {
  const midnight = Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
  const day = value.getUTCDay() || 7;
  return midnight - (day - 1) * 24 * 60 * 60 * 1_000;
}

export function retainedBackupIds(backups: readonly BackupDocument[], now: Date): Set<string> {
  const available = backups
    .filter(backup => backup.availability === 'available')
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const keep = new Set(available.filter(backup => backup.kind === 'explicit').map(backup => backup.id));
  const newest = available[0];
  if (newest) keep.add(newest.id);

  const daily = available.filter(backup => backup.kind === 'daily');
  daily.slice(0, 14).forEach(backup => keep.add(backup.id));
  const currentWeek = utcWeekStart(now);
  for (let offset = 1; offset <= 8; offset += 1) {
    const start = currentWeek - offset * 7 * 24 * 60 * 60 * 1_000;
    const end = start + 7 * 24 * 60 * 60 * 1_000;
    const anchor = daily.find(backup => {
      const created = new Date(backup.createdAt).getTime();
      return created >= start && created < end;
    });
    if (anchor) keep.add(anchor.id);
  }

  const preOperation = available.filter(backup => backup.kind === 'pre-operation');
  preOperation.slice(0, 20).forEach(backup => keep.add(backup.id));
  const thirtyDaysAgo = now.getTime() - 30 * 24 * 60 * 60 * 1_000;
  preOperation.filter(backup => new Date(backup.createdAt).getTime() >= thirtyDaysAgo)
    .forEach(backup => keep.add(backup.id));

  backups.filter(backup => backup.availability !== 'available').forEach(backup => keep.add(backup.id));
  return keep;
}

export class BackupService {
  readonly #journal: CampaignJournal;
  readonly #root: string;
  readonly #now: () => Date;
  #exclusive: Promise<unknown> = Promise.resolve();
  #timer: NodeJS.Timeout | null = null;
  #lastProblem = '';

  constructor(journal: CampaignJournal, root: string, now: () => Date = () => new Date()) {
    this.#journal = journal;
    this.#root = resolve(root);
    this.#now = now;
  }

  async start(): Promise<void> {
    try {
      await this.ensureDailyBackup();
      this.#lastProblem = '';
    } catch (error) {
      this.#lastProblem = `Automatic daily backup failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    this.#timer = setInterval(() => {
      void this.ensureDailyBackup().then(() => { this.#lastProblem = ''; }).catch(error => {
        this.#lastProblem = `Automatic daily backup failed: ${error instanceof Error ? error.message : String(error)}`;
      });
    }, DAILY_CHECK_INTERVAL_MS);
    this.#timer.unref();
  }

  async close(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    await this.#exclusive;
  }

  list(): Promise<BackupCatalog> {
    return this.catalog();
  }

  createExplicit(label?: string): Promise<BackupDocument> {
    return this.serialize(() => this.createBackupUnlocked('explicit', label?.trim() || undefined));
  }

  createPreOperation(label: string): Promise<BackupDocument> {
    const normalized = label.trim();
    if (!normalized) throw new Error('Pre-operation backup label cannot be empty.');
    return this.serialize(() => this.createBackupUnlocked('pre-operation', normalized.slice(0, 160)));
  }

  ensureDailyBackup(): Promise<BackupDocument> {
    return this.serialize(async () => {
      const catalog = await this.catalog();
      const today = utcDay(this.#now());
      const existing = catalog.backups.find(backup => (
        backup.kind === 'daily'
        && backup.availability === 'available'
        && utcDay(new Date(backup.createdAt)) === today
      ));
      if (existing) return existing;
      const created = await this.createBackupUnlocked('daily', `Automatic daily backup ${today}`);
      await this.applyRetentionSafely();
      return created;
    });
  }

  previewRestore(backupId: string): Promise<RestoreBackupPreview> {
    return this.inspectRestore(backupId);
  }

  restore(backupId: string, token: string): Promise<RestoreBackupReceipt> {
    return this.serialize(async () => {
      const preview = await this.inspectRestore(backupId);
      if (preview.restoreToken !== token) {
        throw new CampaignExpectedError(
          'RESTORE_CONFIRMATION_REQUIRED',
          'Backup changed or restore was not previewed. Preview it again before restoring.',
        );
      }
      const safety = await this.createBackupUnlocked('pre-operation', `Before restore of ${backupId}`);
      await this.#journal.restore({ sourcePath: this.backupPath(preview.backup.id) });
      const verification = await this.#journal.verify();
      await this.applyRetentionSafely();
      return {
        schema: 'st-rpg.restore-receipt',
        version: '1.0',
        backupId: preview.backup.id,
        safetyBackupId: safety.id,
        restoredAt: this.#now().toISOString(),
        verification,
      };
    });
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#exclusive.then(work, work);
    this.#exclusive = next.then(() => undefined, () => undefined);
    return next;
  }

  private async createBackupUnlocked(kind: BackupKind, label?: string): Promise<BackupDocument> {
    await mkdir(this.#root, { recursive: true });
    const id = `backup-${randomUUID()}`;
    const fileName = `${id}.sqlite`;
    const destination = this.backupPath(id);
    const partial = `${destination}.partial`;
    const manifest = this.manifestPath(id);
    const manifestPartial = `${manifest}.partial`;
    try {
      await this.#journal.backup({ destinationPath: partial });
      await rename(partial, destination);
      const info = await stat(destination);
      const verification = await this.#journal.verifyBackup({ sourcePath: destination });
      const document: BackupDocument = {
        schema: 'st-rpg.backup',
        version: '1.0',
        id,
        kind,
        ...(label ? { label } : {}),
        createdAt: this.#now().toISOString(),
        fileName,
        sizeBytes: info.size,
        sha256: await checksum(destination),
        availability: 'available',
        verification,
      };
      await writeFile(manifestPartial, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
      await rename(manifestPartial, manifest);
      return document;
    } catch (error) {
      await Promise.allSettled([
        rm(partial, { force: true }),
        rm(manifestPartial, { force: true }),
        rm(destination, { force: true }),
      ]);
      throw error;
    }
  }

  private async catalog(): Promise<BackupCatalog> {
    await mkdir(this.#root, { recursive: true });
    const names = (await readdir(this.#root)).filter(name => name.endsWith('.manifest.json')).sort();
    const backups: BackupDocument[] = [];
    const problems: Array<{ source: string; message: string }> = [];
    for (const name of names) {
      try {
        const candidate = JSON.parse(await readFile(resolve(this.#root, name), 'utf8')) as unknown;
        if (!Value.Check(BackupDocumentSchema, candidate)) throw new Error('Manifest does not match backup schema.');
        const stored = candidate as BackupDocument;
        if (name !== `${stored.id}.manifest.json` || stored.fileName !== `${stored.id}.sqlite`) {
          throw new Error('Manifest identity does not match its files.');
        }
        let availability: BackupDocument['availability'] = 'available';
        try {
          const info = await stat(this.backupPath(stored.id));
          if (!info.isFile()) availability = 'missing';
          else if (info.size !== stored.sizeBytes) availability = 'changed';
        } catch {
          availability = 'missing';
        }
        backups.push({ ...stored, availability });
      } catch (error) {
        problems.push({
          source: name.slice(0, 255),
          message: (error instanceof Error ? error.message : String(error)).slice(0, 512),
        });
      }
    }
    if (this.#lastProblem) problems.push({ source: 'automatic-daily', message: this.#lastProblem.slice(0, 512) });
    backups.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const today = utcDay(this.#now());
    return {
      schema: 'st-rpg.backup-catalog',
      version: '1.0',
      observedAt: this.#now().toISOString(),
      automaticDailyHealthy: backups.some(backup => (
        backup.kind === 'daily'
        && backup.availability === 'available'
        && utcDay(new Date(backup.createdAt)) === today
      )),
      backups,
      problems,
    };
  }

  private async applyRetentionUnlocked(): Promise<void> {
    const catalog = await this.catalog();
    const keep = retainedBackupIds(catalog.backups, this.#now());
    const removable = catalog.backups.filter(backup => (
      backup.availability === 'available'
      && backup.kind !== 'explicit'
      && !keep.has(backup.id)
    ));
    for (const backup of removable) {
      await rm(this.backupPath(backup.id), { force: true });
      await rm(this.manifestPath(backup.id), { force: true });
    }
  }

  private async applyRetentionSafely(): Promise<void> {
    try {
      await this.applyRetentionUnlocked();
    } catch (error) {
      this.#lastProblem = `Backup retention cleanup failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async inspectRestore(backupId: string): Promise<RestoreBackupPreview> {
    const backup = await this.readManifest(backupId);
    const path = this.backupPath(backup.id);
    let info;
    try {
      info = await stat(path);
    } catch {
      throw new CampaignExpectedError('BACKUP_NOT_FOUND', `Backup file for ${backup.id} is missing.`);
    }
    if (!info.isFile() || info.size !== backup.sizeBytes || await checksum(path) !== backup.sha256) {
      throw new CampaignExpectedError('BACKUP_INVALID', `Backup ${backup.id} no longer matches its verified manifest.`);
    }
    const verification = await this.#journal.verifyBackup({ sourcePath: path });
    const available = { ...backup, availability: 'available' as const, verification };
    return {
      schema: 'st-rpg.restore-preview',
      version: '1.0',
      backup: available,
      currentAuthority: await this.#journal.verify(),
      restoreToken: restoreToken(available),
    };
  }

  private async readManifest(backupId: string): Promise<BackupDocument> {
    let candidate: unknown;
    try {
      candidate = JSON.parse(await readFile(this.manifestPath(backupId), 'utf8')) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new CampaignExpectedError('BACKUP_NOT_FOUND', `Backup ${backupId} was not found.`);
      }
      throw new CampaignExpectedError('BACKUP_INVALID', `Backup ${backupId} has an unreadable manifest.`);
    }
    if (!Value.Check(BackupDocumentSchema, candidate)) {
      throw new CampaignExpectedError('BACKUP_INVALID', `Backup ${backupId} has an invalid manifest.`);
    }
    const backup = candidate as BackupDocument;
    if (backup.id !== backupId || backup.fileName !== `${backupId}.sqlite`) {
      throw new CampaignExpectedError('BACKUP_INVALID', `Backup ${backupId} manifest identity does not match.`);
    }
    return backup;
  }

  private backupPath(id: string): string {
    const path = resolve(this.#root, `${id}.sqlite`);
    if (basename(path) !== `${id}.sqlite`) throw new CampaignExpectedError('BACKUP_NOT_FOUND', 'Backup ID is invalid.');
    return path;
  }

  private manifestPath(id: string): string {
    const path = resolve(this.#root, `${id}.manifest.json`);
    if (basename(path) !== `${id}.manifest.json`) throw new CampaignExpectedError('BACKUP_NOT_FOUND', 'Backup ID is invalid.');
    return path;
  }
}
