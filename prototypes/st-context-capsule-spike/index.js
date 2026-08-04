import { buildPrompt, scoreOutput, variants } from './variants.js';

const ROOT_ID = 'rpg-context-capsule-spike';
const RESPONSE_LIMIT = 220;
const PREFLIGHT_LIMIT = 40;
const preflightVariant = { id: 'model-readiness', label: 'Model readiness' };

const state = {
  open: false,
  running: false,
  stopRequested: false,
  status: 'Ready to check the currently selected model.',
  results: [],
  activeVariantId: null,
  returnFocus: null,
  runTarget: null,
  stopMessage: '',
};

function context() {
  return globalThis.SillyTavern?.getContext?.() ?? null;
}

function activeTarget() {
  const current = context();
  const settings = current?.chatCompletionSettings ?? {};
  const source = String(settings.chat_completion_source ?? current?.mainApi ?? 'unknown');
  const modelCandidates = [
    settings.custom_model,
    settings.openai_model,
    settings.openrouter_model,
    settings.claude_model,
    settings.mistralai_model,
    settings.google_model,
  ];
  const model = String(modelCandidates.find(Boolean) ?? 'model not reported');
  return { source, model, key: `${source}:${model}` };
}

function workspaceMarkup() {
  return `
    <section id="${ROOT_ID}" class="rpgctx" role="dialog" aria-modal="true" aria-label="Context Capsule model lab" aria-hidden="true">
      <header class="rpgctx__topbar">
        <div class="rpgctx__brand"><span>MODEL LAB</span><strong>Context Capsule comparison</strong></div>
        <div class="rpgctx__connection"><strong id="rpgctx-api">—</strong><span id="rpgctx-model">—</span></div>
        <button type="button" class="rpgctx__button" data-rpgctx-action="close">Return to chat</button>
      </header>
      <main class="rpgctx__main">
        <section class="rpgctx__intro">
          <span class="rpgctx__eyebrow">PURPOSE</span>
          <h1>Which context does this model actually obey?</h1>
          <p>The check uses the model currently selected in SillyTavern. It compares up to six context formats, but stops immediately if the model rejects the chat, unloads, or spends the whole reply on hidden reasoning. Normal chat and Campaign data are untouched.</p>
          <div class="rpgctx__actions">
            <button type="button" class="rpgctx__primary" data-rpgctx-action="run">Check current model</button>
            <button type="button" data-rpgctx-action="stop">Stop</button>
            <button type="button" data-rpgctx-action="clear">Clear results</button>
          </div>
          <div id="rpgctx-status" class="rpgctx__status" role="status"></div>
        </section>
        <section class="rpgctx__summary">
          <div><span>PROVISIONAL WINNER</span><strong id="rpgctx-winner">Not run</strong></div>
          <div><span>WHAT COUNTS</span><strong>5 facts · no markup · no false claims</strong></div>
        </section>
        <section id="rpgctx-results" class="rpgctx__results" aria-label="Comparison results"></section>
      </main>
    </section>
    <button id="rpgctx-launcher" type="button" aria-controls="${ROOT_ID}" aria-expanded="false" title="Open Context Capsule model lab"><span>C</span><span>Context lab</span></button>
  `;
}

function create(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function bestResult() {
  return [...state.results]
    .filter(result => result.kind === 'completed')
    .sort((left, right) => right.assessment.score - left.assessment.score
      || Number(left.assessment.leaked) - Number(right.assessment.leaked)
      || left.elapsedMs - right.elapsedMs)[0] ?? null;
}

function failureLabel(result) {
  if (result.kind === 'reasoning-budget') return 'Reasoning only';
  if (result.kind === 'reasoning-only') return 'No final answer';
  if (result.kind === 'empty-output') return 'Empty answer';
  return 'Failed';
}

function failureExplanation(result) {
  if (result.kind === 'reasoning-budget') {
    return `The model used the full ${RESPONSE_LIMIT}-token allowance for hidden reasoning and produced no visible answer.`;
  }
  if (result.kind === 'reasoning-only') {
    return 'The model returned hidden reasoning but never produced a visible answer.';
  }
  if (result.kind === 'empty-output') {
    return 'The request completed without any visible answer or reported reasoning.';
  }
  return result.error ?? 'The model request failed.';
}

function renderResults() {
  const root = document.querySelector(`#${ROOT_ID}`);
  if (!root) return;
  const container = root.querySelector('#rpgctx-results');
  container.replaceChildren();

  if (!state.results.length) {
    container.appendChild(create('p', 'rpgctx__empty', 'No model calls have been made. Normal chat and Campaign data are untouched.'));
  }

  for (const result of state.results) {
    const card = create('article', 'rpgctx__result');
    if (result.variant.id === state.activeVariantId) card.classList.add('is-running');
    if (!['completed', 'ready'].includes(result.kind)) card.classList.add('is-error');

    const heading = create('header', 'rpgctx__result-heading');
    const title = create('div');
    title.append(create('span', 'rpgctx__eyebrow', result.variant.id), create('h2', '', result.variant.label));
    const scoreText = result.kind === 'completed'
      ? `${result.assessment.factsPassed}/5`
      : (result.kind === 'ready' ? 'Ready' : failureLabel(result));
    const score = create('strong', 'rpgctx__score', scoreText);
    heading.append(title, score);

    const metrics = create('div', 'rpgctx__result-metrics');
    if (result.kind === 'completed') {
      metrics.append(
        create('span', result.assessment.leaked ? 'is-bad' : 'is-good', result.assessment.leaked ? 'Markup leaked' : 'No markup leak'),
        create('span', result.assessment.repeatedContradiction ? 'is-bad' : 'is-good', result.assessment.repeatedContradiction ? 'Repeated false claim' : 'Rejected false claims'),
        create('span', '', `${result.elapsedMs} ms`),
        create('span', '', `${result.promptBytes} prompt bytes`),
      );
    } else if (result.kind === 'ready') {
      metrics.append(
        create('span', 'is-good', 'Visible answer returned'),
        create('span', '', `${result.elapsedMs} ms`),
      );
    } else {
      metrics.append(
        create('span', 'is-bad', failureExplanation(result)),
        ...(result.elapsedMs ? [create('span', '', `${result.elapsedMs} ms`)] : []),
      );
    }

    const output = create('pre', 'rpgctx__output', result.output || failureExplanation(result));
    const details = create('details', 'rpgctx__details');
    const detailData = result.kind === 'completed'
      ? { model: result.model, values: result.assessment.values, checks: result.assessment.checks }
      : {
          model: result.model,
          finishReason: result.finishReason ?? null,
          visibleCharacters: result.output?.length ?? 0,
          reasoningCharacters: result.reasoningChars ?? 0,
          error: result.error ?? null,
        };
    details.append(create('summary', '', 'Details'), create('pre', '', JSON.stringify(detailData, null, 2)));
    card.append(heading, metrics, output, details);
    container.appendChild(card);
  }

  const winner = bestResult();
  root.querySelector('#rpgctx-winner').textContent = winner
    ? `${winner.variant.label} · ${winner.assessment.factsPassed}/5${winner.assessment.leaked ? ' · leaked' : ''}`
    : 'Not established';
}

function render() {
  const root = document.querySelector(`#${ROOT_ID}`);
  if (!root) return;
  const current = context();
  const target = activeTarget();
  root.querySelector('#rpgctx-api').textContent = `${target.source} · ${current?.onlineStatus ?? 'status unavailable'}`;
  root.querySelector('#rpgctx-model').textContent = target.model;
  root.querySelector('#rpgctx-status').textContent = state.status;
  root.querySelector('[data-rpgctx-action="run"]').disabled = state.running;
  root.querySelector('[data-rpgctx-action="stop"]').disabled = !state.running;
  root.querySelector('[data-rpgctx-action="clear"]').disabled = state.running || !state.results.length;
  renderResults();
}

function promptEventName(current) {
  if (current.mainApi === 'openai') return current.eventTypes?.CHAT_COMPLETION_PROMPT_READY ?? current.event_types?.CHAT_COMPLETION_PROMPT_READY;
  return current.eventTypes?.GENERATE_AFTER_COMBINE_PROMPTS ?? current.event_types?.GENERATE_AFTER_COMBINE_PROMPTS;
}

function extractCompletion(data) {
  if (typeof data === 'string') {
    return { content: data, reasoning: '', finishReason: null };
  }

  const choice = data?.choices?.[0] ?? {};
  const message = choice?.message ?? {};
  const content = message?.content ?? choice?.text ?? data?.text ?? '';
  const reasoning = message?.reasoning_content
    ?? message?.reasoning
    ?? choice?.reasoning_content
    ?? choice?.reasoning
    ?? data?.reasoning_content
    ?? data?.reasoning
    ?? '';
  return {
    content: Array.isArray(content) ? content.map(part => part?.text ?? '').join('') : String(content ?? ''),
    reasoning: typeof reasoning === 'string' ? reasoning : JSON.stringify(reasoning ?? ''),
    finishReason: choice?.finish_reason ?? data?.finish_reason ?? data?.stop_reason ?? null,
  };
}

function classifyCompletion(completion) {
  if (completion.content.trim()) return 'completed';
  if (completion.reasoning.trim() && completion.finishReason === 'length') return 'reasoning-budget';
  if (completion.reasoning.trim()) return 'reasoning-only';
  return 'empty-output';
}

function friendlyError(error) {
  const message = error?.message || error?.error?.message || String(error);
  if (/no user query found/i.test(message)) return 'This model rejected the chat structure. Its prompt template requires a user turn before every assistant history turn.';
  if (/model unloaded/i.test(message)) return 'LM Studio unloaded the selected model while the check was running. Reload it and retry.';
  if (/channel error/i.test(message)) return 'The model connection failed before a usable answer was returned.';
  return message;
}

function stopMessageFor(result) {
  if (result.kind === 'reasoning-budget' || result.kind === 'reasoning-only') {
    return `${result.model} produced only hidden reasoning. Comparison stopped after one call. Use a non-thinking model/preset, or a model that exposes a working reasoning-off control.`;
  }
  if (result.kind === 'empty-output') {
    return `${result.model} returned an empty answer. Comparison stopped after one call; retry once before judging its context format.`;
  }
  return result.error ?? 'The model check could not continue.';
}

async function runPrompt(variant, prompt, responseLength, target, readinessCheck = false) {
  const current = context();
  if (!current?.generateRawData) throw new Error('SillyTavern generateRawData is unavailable.');

  const eventName = promptEventName(current);
  let capturedEvent = null;
  const capture = eventData => { capturedEvent = eventData; };
  if (eventName) current.eventSource?.on(eventName, capture);

  const started = performance.now();
  try {
    const data = await current.generateRawData({
      prompt,
      responseLength,
      instructOverride: false,
      quietToLoud: false,
    });
    const elapsedMs = Math.round(performance.now() - started);
    const captured = capturedEvent?.chat ?? capturedEvent?.prompt ?? prompt;
    const promptBytes = new TextEncoder().encode(JSON.stringify(captured)).length;
    const completion = extractCompletion(data);
    const output = completion.content.trim();
    const completionKind = classifyCompletion(completion);
    const kind = readinessCheck && completionKind === 'completed' ? 'ready' : completionKind;
    return {
      variant,
      kind,
      model: target.model,
      output,
      assessment: kind === 'completed' ? scoreOutput(output) : null,
      elapsedMs,
      promptBytes,
      reasoningChars: completion.reasoning.length,
      finishReason: completion.finishReason,
    };
  } finally {
    if (eventName) current.eventSource?.removeListener(eventName, capture);
  }
}

function runPreflight(target) {
  return runPrompt(
    preflightVariant,
    [
      { role: 'system', content: 'Return a visible final answer. Do not explain.' },
      { role: 'user', content: 'Reply with exactly OK.' },
    ],
    PREFLIGHT_LIMIT,
    target,
    true,
  );
}

function runVariant(variant, target) {
  return runPrompt(variant, buildPrompt(variant), RESPONSE_LIMIT, target, false);
}

async function runAll() {
  if (state.running) return;
  state.running = true;
  state.stopRequested = false;
  state.results = [];
  state.runTarget = activeTarget();
  state.stopMessage = '';

  state.activeVariantId = preflightVariant.id;
  state.status = `Checking whether ${state.runTarget.model} can return a short visible answer.`;
  render();

  try {
    const preflight = await runPreflight(state.runTarget);
    state.results.push(preflight);
    if (preflight.kind !== 'ready') {
      state.stopMessage = stopMessageFor(preflight);
    }
  } catch (error) {
    const message = friendlyError(error);
    state.results.push({ variant: preflightVariant, kind: 'error', model: state.runTarget.model, output: '', error: message });
    state.stopMessage = message;
  }
  render();

  for (let index = 0; !state.stopMessage && index < variants.length; index += 1) {
    if (state.stopRequested) break;
    const currentTarget = activeTarget();
    if (currentTarget.key !== state.runTarget.key) {
      state.stopMessage = 'The selected model changed during the comparison. Results were kept separate; run again for the new model.';
      break;
    }

    const variant = variants[index];
    state.activeVariantId = variant.id;
    state.status = `Checking ${index + 1} of ${variants.length}: ${variant.label} with ${state.runTarget.model}.`;
    render();

    try {
      const result = await runVariant(variant, state.runTarget);
      state.results.push(result);
      if (result.kind !== 'completed') {
        state.stopMessage = stopMessageFor(result);
        render();
        break;
      }
    } catch (error) {
      const message = friendlyError(error);
      state.results.push({ variant, kind: 'error', model: state.runTarget.model, output: '', error: message });
      state.stopMessage = message;
      render();
      break;
    }
    render();
  }

  state.running = false;
  state.activeVariantId = null;
  const winner = bestResult();
  if (state.stopRequested) state.status = `Stopped after ${state.results.length} comparison${state.results.length === 1 ? '' : 's'}.`;
  else if (state.stopMessage) state.status = state.stopMessage;
  else if (state.results.length === variants.length + 1 && winner) state.status = `Screening complete for ${state.runTarget.model}. ${winner.variant.label} is provisional; inspect its prose before accepting it.`;
  else if (winner) state.status = `Partial screening complete for ${state.runTarget.model}. No winner is final until all six formats finish.`;
  else state.status = 'No comparison completed. Check the selected SillyTavern model connection.';
  render();
}

function stop() {
  if (!state.running) return;
  state.stopRequested = true;
  state.status = 'Stopping the current generation…';
  render();
  context()?.stopGeneration?.();
}

function clearResults() {
  if (state.running) return;
  state.results = [];
  state.runTarget = null;
  state.stopMessage = '';
  state.status = 'Results cleared. Normal chat and Campaign data were untouched.';
  render();
}

function openLab(trigger) {
  const root = document.querySelector(`#${ROOT_ID}`);
  if (!root) return;
  state.returnFocus = trigger instanceof HTMLElement ? trigger : document.activeElement;
  state.open = true;
  root.classList.add('is-open');
  root.setAttribute('aria-hidden', 'false');
  document.querySelector('#rpgctx-launcher')?.setAttribute('aria-expanded', 'true');
  render();
  root.querySelector('[data-rpgctx-action="close"]')?.focus();
}

function closeLab() {
  const root = document.querySelector(`#${ROOT_ID}`);
  if (!root) return;
  state.open = false;
  root.classList.remove('is-open');
  root.setAttribute('aria-hidden', 'true');
  document.querySelector('#rpgctx-launcher')?.setAttribute('aria-expanded', 'false');
  state.returnFocus?.focus?.();
}

function handleClick(event) {
  const launcher = event.target.closest('#rpgctx-launcher');
  if (launcher) {
    openLab(launcher);
    return;
  }
  const action = event.target.closest('[data-rpgctx-action]')?.dataset.rpgctxAction;
  if (action === 'close') closeLab();
  if (action === 'run') runAll();
  if (action === 'stop') stop();
  if (action === 'clear') clearResults();
}

function mount() {
  if (document.querySelector(`#${ROOT_ID}`)) return;
  document.body.insertAdjacentHTML('beforeend', workspaceMarkup());
  document.addEventListener('click', handleClick);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.open && !state.running) closeLab();
  });
  render();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
else mount();
