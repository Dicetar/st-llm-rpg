import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import path from 'node:path';
import process from 'node:process';
import {
  REQUIRED_ANCHORS,
  REVISION_ONE_DETAILS,
  REVISION_TWO_DETAILS,
  assertSummaryContainsNoDraftText,
  createRecoveryEntry,
  evaluateText,
  makeModelVerdict,
  resolveExactEntityMentions,
  summarizeRecovery,
} from './core.mjs';

const execFileAsync = promisify(execFile);
const DEFAULT_BASE_URL = 'http://127.0.0.1:1234';
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_TOKENS = 512;

function parseArgs(argv) {
  const result = {
    baseUrl: process.env.LM_STUDIO_BASE_URL || DEFAULT_BASE_URL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxTokens: DEFAULT_MAX_TOKENS,
    models: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === '--model') {
      if (!value || value.startsWith('--')) throw new Error('--model requires an exact LM Studio model ID.');
      result.models.push(value);
      index += 1;
    } else if (arg === '--base-url') {
      if (!value || value.startsWith('--')) throw new Error('--base-url requires a URL.');
      result.baseUrl = value.replace(/\/$/, '');
      index += 1;
    } else if (arg === '--timeout-ms') {
      result.timeoutMs = Number(value);
      index += 1;
    } else if (arg === '--max-tokens') {
      result.maxTokens = Number(value);
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!Number.isInteger(result.timeoutMs) || result.timeoutMs < 10_000) {
    throw new Error('--timeout-ms must be an integer of at least 10000.');
  }
  if (!Number.isInteger(result.maxTokens) || result.maxTokens < 128 || result.maxTokens > 2048) {
    throw new Error('--max-tokens must be an integer from 128 to 2048.');
  }
  result.models = [...new Set(result.models)];
  return result;
}

function printHelp() {
  console.log(`Usage:\n  npm run prototype:enrichment -- --model "exact-model-id-1" --model "exact-model-id-2"\n\nOptions:\n  --base-url http://127.0.0.1:1234\n  --timeout-ms 180000\n  --max-tokens 512\n\nThe command never loads, unloads, or changes model settings. It exits with an error when a required condition fails.`);
}

function apiHeaders() {
  const headers = { 'content-type': 'application/json' };
  if (process.env.LM_STUDIO_API_TOKEN) {
    headers.authorization = `Bearer ${process.env.LM_STUDIO_API_TOKEN}`;
  }
  return headers;
}

async function fetchJson(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs} ms.`)), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const bodyText = await response.text();
    let body;
    try {
      body = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      throw new Error(`LM Studio returned non-JSON HTTP ${response.status}: ${bodyText.slice(0, 300)}`);
    }
    if (!response.ok) {
      const detail = body?.error?.message ?? body?.message ?? bodyText.slice(0, 500);
      throw new Error(`LM Studio HTTP ${response.status}: ${detail}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function listModels(baseUrl, timeoutMs) {
  const body = await fetchJson(`${baseUrl}/v1/models`, { method: 'GET', headers: apiHeaders() }, timeoutMs);
  return Array.isArray(body?.data) ? body.data.map(item => String(item?.id ?? '')).filter(Boolean) : [];
}

async function readGpu() {
  const { stdout } = await execFileAsync('nvidia-smi', [
    '--query-gpu=memory.used,memory.total,utilization.gpu',
    '--format=csv,noheader,nounits',
  ], { windowsHide: true, timeout: 10_000 });
  const first = String(stdout).trim().split(/\r?\n/)[0];
  const [used, total, utilization] = first.split(',').map(value => Number(value.trim()));
  if (![used, total, utilization].every(Number.isFinite)) {
    throw new Error(`Could not parse nvidia-smi output: ${first}`);
  }
  return { usedMiB: used, totalMiB: total, utilizationPercent: utilization };
}

async function withGpuSampling(task) {
  const samples = [await readGpu()];
  let polling = false;
  const interval = setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      samples.push(await readGpu());
    } catch {
      // Initial preflight already proved nvidia-smi works. One missed poll is not fatal.
    } finally {
      polling = false;
    }
  }, 500);
  try {
    const value = await task();
    return { value, samples };
  } finally {
    clearInterval(interval);
    try {
      samples.push(await readGpu());
    } catch {
      // Preserve the model result even when the final telemetry sample is unavailable.
    }
  }
}

function visibleContent(message) {
  if (typeof message?.content === 'string') return message.content.trim();
  if (Array.isArray(message?.content)) {
    return message.content
      .map(part => typeof part === 'string' ? part : part?.text ?? '')
      .join('')
      .trim();
  }
  return '';
}

async function complete({ baseUrl, timeoutMs, maxTokens, model, messages, label }) {
  const started = performance.now();
  const sampled = await withGpuSampling(() => fetchJson(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.35,
      top_p: 0.9,
      max_tokens: maxTokens,
      stream: false,
      seed: 4242,
    }),
  }, timeoutMs));
  const elapsedMs = Math.round(performance.now() - started);
  const message = sampled.value?.choices?.[0]?.message;
  const content = visibleContent(message);
  const reasoningChars = String(message?.reasoning_content ?? message?.reasoning ?? '').length;
  if (!content) {
    const reason = reasoningChars > 0
      ? `reasoning-only output (${reasoningChars} hidden characters)`
      : 'empty visible output';
    throw new Error(`${model} failed ${label}: ${reason}.`);
  }
  const peak = sampled.samples.reduce((best, sample) => sample.usedMiB > best.usedMiB ? sample : best, sampled.samples[0]);
  return {
    content,
    metrics: {
      label,
      latencyMs: elapsedMs,
      visibleChars: content.length,
      reasoningChars,
      promptTokens: Number(sampled.value?.usage?.prompt_tokens ?? 0),
      completionTokens: Number(sampled.value?.usage?.completion_tokens ?? 0),
      peakVramMiB: peak.usedMiB,
      totalVramMiB: peak.totalMiB,
      peakGpuUtilizationPercent: Math.max(...sampled.samples.map(sample => sample.utilizationPercent)),
    },
  };
}

const DRAFT_MESSAGES = Object.freeze([
  Object.freeze({
    role: 'system',
    content: 'Write concise third-person fantasy prose. Follow every material event exactly. Return only the scene, with no analysis or headings.',
  }),
  Object.freeze({
    role: 'user',
    content: `Write 110-160 words. Material events that must all remain true:\n- Nera enters the archive alone.\n- She walks exactly 12 measured steps to a wardrobe.\n- She says the exact sentence: "Three turns, then pull."\n- She does not open the wardrobe; it remains closed at the end.\nDo not invent the wardrobe's appearance, ownership, mechanism, faction meaning, contents, or danger.`,
  }),
]);

function revisionOneMessages(draft) {
  return [
    {
      role: 'system',
      content: 'Revise a hidden narration draft using added Campaign context. Return one full replacement scene only. Preserve every material event, exact number, exact quoted sentence, outcome, and the fact that the wardrobe remains closed.',
    },
    {
      role: 'user',
      content: `HIDDEN DRAFT\n${draft}\n\nKNOWN CONTEXT\nThe archive wardrobe is black oak. Its left door bears a blue glass eye. A Brass Raven emblem is set directly below the eye.\n\nNARRATOR SECRET — USE SILENTLY\nThe keyhole has a poison needle identified internally as VIOLET-NEEDLE-73. Do not state, quote, name, hint at, or expose this secret.\n\nRewrite the complete scene in 110-180 words. Use the blue glass eye and Brass Raven emblem naturally. Do not add a new action and do not open the wardrobe.`,
    },
  ];
}

function revisionTwoMessages(candidate) {
  return [
    {
      role: 'system',
      content: 'Perform one final bounded enrichment revision. Return one full replacement scene only. Preserve all existing material events, exact number, exact dialogue, known wardrobe details, and closed outcome.',
    },
    {
      role: 'user',
      content: `CURRENT CANDIDATE\n${candidate}\n\nNEWLY RESOLVED KNOWN CONTEXT\nThe Brass Raven is a courier guild. On furniture, its emblem is a debt mark showing that a courier debt was paid.\n\nAdd only one subtle clause or sentence that conveys the debt-mark meaning. Preserve the blue glass eye, the exact sentence "Three turns, then pull.", exactly 12 steps, and the closed wardrobe. Never mention VIOLET-NEEDLE-73 or a poison needle.`,
    },
  ];
}

async function runModel(config, model) {
  console.log(`\n[${model}] readiness`);
  const readinessCall = await complete({
    ...config,
    model,
    maxTokens: 64,
    label: 'visible-output readiness',
    messages: [
      { role: 'system', content: 'Return a visible answer. No reasoning or explanation.' },
      { role: 'user', content: 'Reply with exactly READY.' },
    ],
  });
  const readiness = { pass: /^READY[.!]?$/i.test(readinessCall.content), metrics: readinessCall.metrics };
  if (!readiness.pass) throw new Error(`${model} failed readiness: expected READY, got ${readinessCall.content.slice(0, 120)}`);

  console.log(`[${model}] hidden draft`);
  const draftCall = await complete({ ...config, model, messages: DRAFT_MESSAGES, label: 'hidden draft' });
  const draft = evaluateText(draftCall.content, { details: [] });
  if (!draft.pass) throw new Error(`${model} draft failed checks: ${draft.failedChecks.join(', ')}`);

  const wardrobeMatch = resolveExactEntityMentions(draftCall.content, [
    { id: 'archive-wardrobe', name: 'Archive Wardrobe', aliases: ['wardrobe'] },
  ]);
  if (!wardrobeMatch.selected) throw new Error(`${model} draft did not uniquely resolve Archive Wardrobe.`);

  console.log(`[${model}] enrichment revision 1`);
  const revisionOneCall = await complete({
    ...config,
    model,
    messages: revisionOneMessages(draftCall.content),
    label: 'enrichment revision 1',
  });
  const revisionOne = evaluateText(revisionOneCall.content, { details: REVISION_ONE_DETAILS });
  if (!revisionOne.pass) throw new Error(`${model} revision 1 failed checks: ${revisionOne.failedChecks.join(', ')}`);

  const factionMatch = resolveExactEntityMentions(revisionOneCall.content, [
    { id: 'brass-raven', name: 'Brass Raven', aliases: ['Brass Raven'] },
  ]);
  if (!factionMatch.selected) throw new Error(`${model} revision 1 did not introduce the uniquely resolvable Brass Raven subject.`);

  console.log(`[${model}] enrichment revision 2`);
  const revisionTwoCall = await complete({
    ...config,
    model,
    messages: revisionTwoMessages(revisionOneCall.content),
    label: 'enrichment revision 2',
  });
  const revisionTwo = evaluateText(revisionTwoCall.content, {
    details: [...REVISION_ONE_DETAILS, ...REVISION_TWO_DETAILS],
  });
  if (!revisionTwo.pass) throw new Error(`${model} revision 2 failed checks: ${revisionTwo.failedChecks.join(', ')}`);

  const ambiguity = resolveExactEntityMentions('She studies the wardrobe.', [
    { id: 'archive-wardrobe', name: 'Archive Wardrobe', aliases: ['wardrobe'] },
    { id: 'guest-wardrobe', name: 'Guest Wardrobe', aliases: ['wardrobe'] },
  ]);
  if (ambiguity.selected || ambiguity.ambiguity.length !== 2) {
    throw new Error(`${model} ambiguity policy failed: a same-alias wardrobe was selected.`);
  }

  const recovery = summarizeRecovery(createRecoveryEntry({
    modelId: model,
    stage: 'revision-1',
    draft: draftCall.content,
    error: new Error('forced prototype revision failure'),
  }));

  const verdict = makeModelVerdict({ readiness, draft, revisionOne, revisionTwo, ambiguity, recovery });
  const calls = [readinessCall.metrics, draftCall.metrics, revisionOneCall.metrics, revisionTwoCall.metrics];
  const result = {
    modelId: model,
    verdict: verdict.verdict,
    hardFailures: verdict.hardFailures,
    readiness,
    draft: { ...draft, metrics: draftCall.metrics, uniqueEntity: wardrobeMatch.selected.name },
    revisionOne: { ...revisionOne, metrics: revisionOneCall.metrics, newlyResolvedEntity: factionMatch.selected.name },
    revisionTwo: { ...revisionTwo, metrics: revisionTwoCall.metrics },
    ambiguity: { selected: false, candidates: ambiguity.ambiguity.map(item => item.name) },
    recovery,
    totals: {
      modelCalls: calls.length,
      latencyMs: calls.reduce((total, call) => total + call.latencyMs, 0),
      peakVramMiB: Math.max(...calls.map(call => call.peakVramMiB)),
      totalVramMiB: Math.max(...calls.map(call => call.totalVramMiB)),
    },
  };
  assertSummaryContainsNoDraftText(result, [draftCall.content, revisionOneCall.content, revisionTwoCall.content]);

  draftCall.content = '';
  revisionOneCall.content = '';
  revisionTwoCall.content = '';
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (Number(process.versions.node.split('.')[0]) < 24) {
    throw new Error(`Node 24 or newer is required; current version is ${process.version}.`);
  }

  console.log(`LM Studio: ${args.baseUrl}`);
  const available = await listModels(args.baseUrl, args.timeoutMs);
  if (args.models.length < 2) {
    throw new Error(`Provide at least two exact model IDs with repeated --model arguments. Available IDs:\n${available.map(id => `  ${id}`).join('\n') || '  (none returned)'}`);
  }
  const missing = args.models.filter(model => !available.includes(model));
  if (missing.length) {
    throw new Error(`Model IDs not returned by LM Studio: ${missing.join(', ')}\nAvailable IDs:\n${available.map(id => `  ${id}`).join('\n')}`);
  }

  const gpu = await readGpu();
  console.log(`GPU preflight: ${gpu.usedMiB}/${gpu.totalMiB} MiB used`);

  const config = {
    baseUrl: args.baseUrl,
    timeoutMs: args.timeoutMs,
    maxTokens: args.maxTokens,
  };
  const modelResults = [];
  const failures = [];
  for (const model of args.models) {
    try {
      modelResults.push(await runModel(config, model));
    } catch (error) {
      failures.push({ modelId: model, error: String(error?.message ?? error) });
      console.error(`[${model}] ERROR: ${error?.message ?? error}`);
    }
  }

  const summary = {
    schema: 'st-rpg.hidden-draft-enrichment-spike',
    version: 1,
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      baseUrl: args.baseUrl,
      gpuTotalMiB: gpu.totalMiB,
    },
    policy: {
      modelCountRequired: 2,
      maximumEnrichmentRevisions: 2,
      ambiguitySelectsNothing: true,
      rawDraftsPersisted: false,
      automaticRetries: false,
    },
    modelResults,
    failures,
    pass: failures.length === 0 && modelResults.length >= 2 && modelResults.every(item => item.verdict === 'go-two-revisions'),
  };
  const outputDir = path.resolve('.runtime', 'enrichment-spike');
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'latest.json');
  await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(`\nSummary: ${outputPath}`);
  for (const result of modelResults) {
    console.log(`${result.modelId}: ${result.verdict}; ${result.totals.latencyMs} ms total; peak ${result.totals.peakVramMiB}/${result.totals.totalVramMiB} MiB`);
  }
  if (!summary.pass) {
    const reasons = failures.map(item => `${item.modelId}: ${item.error}`);
    throw new Error(`Enrichment prototype failed. ${reasons.join(' | ') || 'At least two models did not produce a GO verdict.'} Summary: ${outputPath}`);
  }
  console.log('PASS: two representative models preserved all events through two bounded enrichment revisions.');
}

main().catch(error => {
  console.error(`\nERROR: ${error?.message ?? error}`);
  process.exitCode = 1;
});
