export const EXCHANGE_HEADER = 'X-ST-RPG-Exchange';

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function encodeNarrationExchange(exchange) {
  const bytes = new TextEncoder().encode(canonicalJson(exchange));
  if (bytes.byteLength > 4096) throw new Error('RPG narration exchange exceeds 4 KiB.');
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `v1.${btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')}`;
}

export function bindingRoute(marker) {
  if (marker === undefined || marker === null) return { kind: 'unlinked' };
  const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
  const keys = typeof marker === 'object' && marker !== null ? Object.keys(marker).sort() : [];
  if (
    typeof marker !== 'object'
    || marker === null
    || marker.schema !== 'st-rpg.chat-binding-marker'
    || marker.version !== '1.0'
    || typeof marker.bindingId !== 'string'
    || !identifier.test(marker.bindingId)
    || typeof marker.campaignId !== 'string'
    || !identifier.test(marker.campaignId)
    || keys.join(',') !== 'bindingId,campaignId,schema,version'
  ) {
    throw new Error('This chat has malformed RPG Companion Binding metadata. Open Campaign Book to inspect it.');
  }
  return { kind: 'linked', bindingId: marker.bindingId };
}

export function mergeExchangeHeader(existing, value) {
  const kept = String(existing ?? '')
    .split(/\r?\n/u)
    .filter(line => !new RegExp(`^\\s*${EXCHANGE_HEADER}\\s*:`, 'iu').test(line))
    .filter(line => line.trim().length > 0);
  kept.push(`${EXCHANGE_HEADER}: ${value}`);
  return kept.join('\n');
}
