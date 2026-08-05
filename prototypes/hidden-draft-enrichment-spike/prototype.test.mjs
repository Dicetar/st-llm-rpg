import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REQUIRED_ANCHORS,
  REVISION_ONE_DETAILS,
  REVISION_TWO_DETAILS,
  assertSummaryContainsNoDraftText,
  createRecoveryEntry,
  evaluateText,
  makeModelVerdict,
  normalizeText,
  resolveExactEntityMentions,
  summarizeRecovery,
} from './core.mjs';

const base = 'Nera enters the archive alone. She walks 12 measured steps to the wardrobe and says, "Three turns, then pull." The wardrobe remains closed.';
const rev1 = `${base} Its left door bears a blue glass eye beneath a Brass Raven emblem.`;
const rev2 = `${rev1} The emblem is a courier debt mark showing that the debt was paid.`;

test('normalizes deterministic exact-match text', () => {
  assert.equal(normalizeText('  Brass—Raven  '), 'brass raven');
});

test('selects one exact entity and skips ambiguous aliases', () => {
  const unique = resolveExactEntityMentions('The Brass Raven watches.', [
    { id: 'f1', name: 'Brass Raven', aliases: ['raven guild'] },
  ]);
  assert.equal(unique.selected.id, 'f1');
  assert.equal(unique.ambiguity.length, 0);

  const ambiguous = resolveExactEntityMentions('She studies the wardrobe.', [
    { id: 'w1', name: 'Archive Wardrobe', aliases: ['wardrobe'] },
    { id: 'w2', name: 'Guest Wardrobe', aliases: ['wardrobe'] },
  ]);
  assert.equal(ambiguous.selected, null);
  assert.equal(ambiguous.ambiguity.length, 2);
});

test('draft and revisions require preservation anchors and added details', () => {
  assert.equal(evaluateText(base, { required: REQUIRED_ANCHORS, details: [] }).pass, true);
  assert.equal(evaluateText(rev1, { required: REQUIRED_ANCHORS, details: REVISION_ONE_DETAILS }).pass, true);
  assert.equal(evaluateText(rev2, { required: REQUIRED_ANCHORS, details: [...REVISION_ONE_DETAILS, ...REVISION_TWO_DETAILS] }).pass, true);
});

test('secret leakage fails the candidate', () => {
  const result = evaluateText(`${rev2} VIOLET-NEEDLE-73 is a poison needle.`, {
    required: REQUIRED_ANCHORS,
    details: [...REVISION_ONE_DETAILS, ...REVISION_TWO_DETAILS],
  });
  assert.equal(result.pass, false);
  assert.deepEqual(result.failedChecks.sort(), ['secret-code', 'secret-device']);
});

test('recovery summary retains only metadata, not draft prose', () => {
  const recovery = createRecoveryEntry({ modelId: 'model', stage: 'revision-1', draft: base, error: new Error('forced failure') });
  const summary = summarizeRecovery(recovery);
  assert.equal(summary.recoverable, true);
  assert.equal(summary.draftChars, base.length);
  assert.equal(JSON.stringify(summary).includes(base), false);
});

test('model verdict requires visible output, preservation, ambiguity skip, and recovery', () => {
  const draft = evaluateText(base, { details: [] });
  const revisionOne = evaluateText(rev1, { details: REVISION_ONE_DETAILS });
  const revisionTwo = evaluateText(rev2, { details: [...REVISION_ONE_DETAILS, ...REVISION_TWO_DETAILS] });
  const ambiguity = resolveExactEntityMentions('the wardrobe', [
    { id: 'w1', name: 'Archive Wardrobe', aliases: ['wardrobe'] },
    { id: 'w2', name: 'Guest Wardrobe', aliases: ['wardrobe'] },
  ]);
  const recovery = summarizeRecovery(createRecoveryEntry({ modelId: 'model', stage: 'revision-1', draft: base, error: 'forced' }));
  const verdict = makeModelVerdict({ readiness: { pass: true }, draft, revisionOne, revisionTwo, ambiguity, recovery });
  assert.equal(verdict.verdict, 'go-two-revisions');
  assert.deepEqual(verdict.hardFailures, []);
});

test('persisted summary rejects raw candidate prose', () => {
  const safe = { model: 'x', draftChars: base.length };
  assert.doesNotThrow(() => assertSummaryContainsNoDraftText(safe, [base, rev1, rev2]));
  assert.throws(() => assertSummaryContainsNoDraftText({ bad: base }, [base]), /persisted raw draft/i);
});
