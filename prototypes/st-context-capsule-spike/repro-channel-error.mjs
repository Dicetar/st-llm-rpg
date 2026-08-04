import { buildPrompt, variants } from './variants.js';

const endpoint = process.env.RPG_CONTEXT_REPRO_ENDPOINT ?? 'http://10.8.1.2:1234/v1';
const model = process.env.RPG_CONTEXT_REPRO_MODEL ?? 'qwen3.5-9b-uncensored-hauhaucs-aggressive';
let failed = false;

for (const variant of variants) {
  const started = performance.now();
  try {
    const response = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: buildPrompt(variant),
        max_tokens: 220,
        temperature: 0.7,
        stream: false,
      }),
      signal: AbortSignal.timeout(90_000),
    });
    const raw = await response.text();
    let data = null;
    try { data = JSON.parse(raw); } catch { data = null; }
    const choice = data?.choices?.[0];
    const content = String(choice?.message?.content ?? '');
    const reasoning = String(choice?.message?.reasoning_content ?? '');
    const verdict = response.ok && (content.length > 0 || reasoning.length > 0) ? 'PASS' : 'CHANNEL_ERROR';
    if (verdict !== 'PASS') failed = true;
    console.log(JSON.stringify({
      variant: variant.id,
      verdict,
      httpStatus: response.status,
      elapsedMs: Math.round(performance.now() - started),
      contentChars: content.length,
      reasoningChars: reasoning.length,
      finishReason: choice?.finish_reason ?? null,
      error: typeof data?.error === 'string'
        ? data.error
        : (data?.error?.message ?? data?.message ?? (!data ? raw.slice(0, 300) : null)),
    }));
  } catch (error) {
    failed = true;
    console.log(JSON.stringify({
      variant: variant.id,
      verdict: 'CHANNEL_ERROR',
      elapsedMs: Math.round(performance.now() - started),
      error: error?.message ?? String(error),
    }));
  }
}

process.exitCode = failed ? 1 : 0;
