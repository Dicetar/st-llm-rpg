import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { OpsProblem, digest } from './core.mjs';

async function stableRead(path) {
  const before = await stat(path);
  const content = await readFile(path, 'utf8');
  const after = await stat(path);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw new OpsProblem('addon_file_unstable', `File changed while reading: ${path}`, ['rescan']);
  }
  return { content, size: after.size, mtimeMs: after.mtimeMs, hash: digest(content) };
}

export async function reconcileAddonDirectory(directory) {
  const names = (await readdir(directory)).filter((name) => name.endsWith('.json') && !name.endsWith('_example.json')).sort();
  const files = [];
  const errors = [];
  for (const name of names) {
    const path = join(directory, name);
    try {
      const read = await stableRead(path);
      let document;
      try { document = JSON.parse(read.content); }
      catch { throw new OpsProblem('addon_json_malformed', `Malformed JSON: ${name}`, ['fix-file', 'rescan']); }
      files.push({ name, path, ...read, document });
    } catch (error) {
      errors.push({ name, code: error.code ?? 'addon_read_failed', message: error.message });
    }
  }
  const manifest = files.map(({ name, size, mtimeMs, hash }) => ({ name, size, mtimeMs, hash }));
  return { directory, manifest, manifestHash: digest(manifest), files, errors };
}
