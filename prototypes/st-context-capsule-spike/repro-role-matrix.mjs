const endpoint = process.env.RPG_CONTEXT_REPRO_ENDPOINT ?? 'http://10.8.1.2:1234/v1';
const model = process.env.RPG_CONTEXT_REPRO_MODEL ?? 'qwen3.5-9b-uncensored-hauhaucs-aggressive';

const cases = [
  { id: 'user-only', messages: [{ role: 'user', content: 'Reply only OK.' }] },
  { id: 'system-user', messages: [{ role: 'system', content: 'Reply concisely.' }, { role: 'user', content: 'Reply only OK.' }] },
  { id: 'alternating', messages: [{ role: 'system', content: 'Reply concisely.' }, { role: 'user', content: 'Say READY.' }, { role: 'assistant', content: 'READY.' }, { role: 'user', content: 'Reply only OK.' }] },
  { id: 'assistant-before-user', messages: [{ role: 'system', content: 'Reply concisely.' }, { role: 'assistant', content: 'Earlier claim.' }, { role: 'user', content: 'Reply only OK.' }] },
  { id: 'two-leading-system', messages: [{ role: 'system', content: 'Rule one.' }, { role: 'system', content: 'Rule two.' }, { role: 'user', content: 'Reply only OK.' }] },
  { id: 'mid-system', messages: [{ role: 'system', content: 'Reply concisely.' }, { role: 'user', content: 'Say READY.' }, { role: 'assistant', content: 'READY.' }, { role: 'system', content: 'Use current state.' }, { role: 'user', content: 'Reply only OK.' }] },
  { id: 'adjacent-user', messages: [{ role: 'system', content: 'Reply concisely.' }, { role: 'user', content: 'Reference state.' }, { role: 'user', content: 'Reply only OK.' }] },
];

let failed = false;
for (const item of cases) {
  const started = performance.now();
  try {
    const response = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: item.messages, max_tokens: 32, temperature: 0, stream: false }),
      signal: AbortSignal.timeout(30_000),
    });
    const raw = await response.text();
    let data = null;
    try { data = JSON.parse(raw); } catch { data = null; }
    const choice = data?.choices?.[0];
    const content = String(choice?.message?.content ?? '');
    const reasoning = String(choice?.message?.reasoning_content ?? '');
    const error = typeof data?.error === 'string' ? data.error : (data?.error?.message ?? data?.message ?? null);
    const verdict = response.ok && (content.length || reasoning.length) ? 'PASS' : 'FAIL';
    if (verdict === 'FAIL') failed = true;
    console.log(JSON.stringify({ id: item.id, verdict, httpStatus: response.status, elapsedMs: Math.round(performance.now() - started), contentChars: content.length, reasoningChars: reasoning.length, error }));
  } catch (error) {
    failed = true;
    console.log(JSON.stringify({ id: item.id, verdict: 'FAIL', elapsedMs: Math.round(performance.now() - started), error: error?.message ?? String(error) }));
  }
}

process.exitCode = failed ? 1 : 0;
