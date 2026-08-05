# Local model fit under 40B for an uncensored SillyTavern RPG

Research date: 2026-08-01

## Bottom line

The best fit is **not one universal model**. Use two deliberately different jobs:

1. **Narrator/writer:** an unrestricted roleplay tune at creative sampling settings.
2. **State extractor:** a non-thinking instruct model at low temperature that returns a small validated change proposal.

For the models already installed, the strongest starting combination is:

- **Writer: `ReadyArt/Melody1437-26B-A4B-v2.0`**. This is a provisional first choice, not a benchmarked final winner. Its creator explicitly trained it for adult ERP, mature themes and uncensored dialogue; its output training removes reasoning tags and excessive Markdown. The local Capsule screen also showed that it can obey compact state context reasonably well. Its own card warns that ordinary question-style prompts may still refuse, so it should narrate through a structured roleplay prompt rather than be trusted as the database worker. [Creator model card](https://huggingface.co/ReadyArt/Melody1437-26B-A4B-v2.0)
- **Extractor now: `mistralai/Mistral-Nemo-Instruct-2407`**. It is already installed, is a conventional non-thinking 12B instruct model, supports function calling, was trained with a 128k context window, and Mistral explicitly says it has no moderation mechanisms. Those properties are a much better match for bounded, low-latency change extraction from explicit chat than a creative tune. Mistral recommends a low temperature around 0.3; the RPG extractor should start lower, around 0.1-0.2, and be measured. [Official model card](https://huggingface.co/mistralai/Mistral-Nemo-Instruct-2407)
- **Extractor upgrade to screen: `mistralai/Ministral-3-14B-Instruct-2512`**. Mistral describes strong system-prompt adherence, native function calling and JSON output, a 256k window, and recommends temperature below 0.1 for production use. It is the most promising current under-20B state-worker candidate on paper, but the card makes no unrestricted-content promise, so it must pass an explicit-content extraction fixture before adoption. [Official model card](https://huggingface.co/mistralai/Ministral-3-14B-Instruct-2512)
- **Next writer to download and A/B: `zerofata/MS3.2-PaintedFantasy-v4-24B`**. Its creator explicitly targets uncensored character RP/ERP, uses Mistral v7 Tekken, trained 90% of examples without thinking, and mixed NSFW roleplay/story data with creative-instruct, chat and preference data intended to stabilize logic. Its Q4_K_M artifact is about 14.3 GB, a materially better fit for the local 16 GB GPU than the 16.8 GB Melody artifact or a 19.8 GB 32B Q4. These are creator claims, so it should challenge Melody rather than replace it sight unseen. [Creator model card](https://huggingface.co/zerofata/MS3.2-PaintedFantasy-v4-24B)

If only one model may be used, keep **Melody 26B v2** for now and make all extracted changes reviewable. A more conservative one-model alternative is the installed **Mistral Small 22B ArliAI RPMax v1.1**, but its card establishes creative roleplay training, not uncensored behavior or structured extraction reliability. Neither one-model option meets the same robustness bar as the split pipeline.

## Answer to the capability question

“Uncensored” is not inherently opposed to instruction following or analysis. Refusal removal and task capability are separate dimensions. For example, HauhauCS claims its Qwen3.5 9B edit reached 0 refusals in 465 prompts without changing capabilities, while the Gemma StyleTune ARA card reports a measurable but small distribution change and 8 refusals in 100 rather than zero. These are creator-reported results, not independent evaluations. [HauhauCS card](https://huggingface.co/HauhauCS/Qwen3.5-9B-Uncensored-HauhauCS-Aggressive), [Gemma ARA card](https://huggingface.co/densenet/Gemma-4-31B-StyleTune-heretic-ara)

The practical conflict comes from **specialization and prompting**:

- creative/ERP fine-tunes reward voice, continuation, emotional intensity and variety;
- state extraction rewards literal evidence, omission of unsupported facts, exact field names and machine-valid output;
- creative narration wants higher entropy; extraction wants low entropy;
- combining prose and a machine block in one generation gives the model two competing objectives and lets a malformed state block spoil an otherwise good scene.

Therefore a good erotic writer may be mediocre at JSON without being generally “dumb,” and a good extractor may write sterile fiction without being generally weak.

## Installed candidates

The local LM Studio inventory was inspected on 2026-08-01. Sizes and context values below describe the installed artifacts, not universal properties of every quantization.

| Installed model | Writer fit | Extractor fit | Evidence and decision |
|---|---:|---:|---|
| `melody1437-26b-a4b-v2.0` (Gemma 4, Q4_K_M) | High | Medium-low | Creator targets explicit adult ERP, character/emotional consistency and clean narration; warns standard queries can refuse. Best current writer starting point. [Card](https://huggingface.co/ReadyArt/Melody1437-26B-A4B-v2.0) |
| `melody1437-27b` (Qwen 3.6, Q4_K_M) | High, unverified locally | Low until screened | Creator targets adult ERP and says reasoning tags were stripped, but also requires a structured roleplay system prompt and warns ordinary queries may refuse. Qwen 3.6 ancestry makes the exact LM Studio template/preset important. [Card](https://huggingface.co/ReadyArt/Melody1437-27B), [GGUF card](https://huggingface.co/ReadyArt/Melody1437-27B-GGUF) |
| `gemma-4-31b-styletune-heretic-ara-i1` (Q4_K_M) | High | Medium-low | Original StyleTune trained narrative style through the output head and reports 60% fewer clichés on its own 200-prompt set. The later ARA decensor changes layers 30-48 and reports 8/100 refusals versus 99/100 for the original, so “fully uncensored” and “capabilities untouched” should not be assumed for this derivative. Bad XML adherence does not by itself mean bad prose. [StyleTune card](https://huggingface.co/Gryphe/Gemma-4-31B-StyleTune), [ARA card](https://huggingface.co/densenet/Gemma-4-31B-StyleTune-heretic-ara) |
| `mistral-small-22b-arliai-rpmax-v1.1` (Q4_K_L) | Medium-high | Medium, unproven | RPMax was trained on varied, deduplicated creative-writing/RP data to reduce repeated characters and situations. It retains Mistral Instruct format and 32k context, but the card does not claim uncensored behavior, JSON accuracy or extraction benchmarks. Good stable-writer challenger. [Card](https://huggingface.co/ArliAI/Mistral-Small-22B-ArliAI-RPMax-v1.1) |
| `dirty-muse-writer-v01-uncensored-erotica-nsfw-i1` (Gemma 2, Q6_K) | Medium for narrow ERP | Low | The source card documents only a TIES merge of three 9B writer/abliterated models. It provides no instruction-following, long-context or structured-output evidence. The local artifact has an 8k maximum context and no advertised tool use. Keep as a flavor model, not campaign infrastructure. [Card](https://huggingface.co/Mantis2024/Dirty-Muse-Writer-v01-Uncensored-Erotica-NSFW) |
| `the-crow-9b-creative-writing-opus4.6-distill-heretic` (“Crow 8B”) | Medium-high for prose | Poor | Its creator positions it for character RP and creative/emotional writing, and explicitly says it is not recommended for pure factual QA or math because it tends toward narrative answers. Its published benchmark samples are only 10 questions each, so the numerical scores are weak evidence. [Card](https://huggingface.co/Crownelius/The-Crow-9B-Creative-Writing-Opus4.6-DISTILL-Heretic) |
| `qwen3.5-9b-uncensored-hauhaucs-aggressive` (Q4_K_M) | Unknown | High on paper, unusable in current path | The card claims 0/465 refusals and no capability loss. Official Qwen says Qwen3.5 thinks by default and requires `chat_template_kwargs.enable_thinking=false`; it does not support Qwen3’s `/nothink` soft switch. The current LM Studio path ignored the control and returned reasoning without a visible answer, so runtime evidence disqualifies this artifact until that integration is fixed. [Tune card](https://huggingface.co/HauhauCS/Qwen3.5-9B-Uncensored-HauhauCS-Aggressive), [official Qwen3.5 card](https://huggingface.co/Qwen/Qwen3.5-9B) |
| `qwen3.6-27b-fable-fusion-711-uncensored-heretic-nm-dau-neo-max-mtp` (Q4_K_M) | Potentially high | High on paper, unusable in current path | The creator reports broad benchmark gains, 4/100 refusals and both thinking/non-thinking settings, but also says it was not designed primarily as a creative model. In the actual LM Studio/SillyTavern path it repeatedly exhausted the response budget in hidden reasoning and produced no final answer. Do not use it in a reliability-first workflow until the runtime can enforce non-thinking mode. [Creator card](https://huggingface.co/DavidAU/Qwen3.6-27B-Fable-Fusion-711-Uncensored-Heretic-NM-DAU-NEO-MAX-MTP-GGUF), [official Qwen3.6 card](https://huggingface.co/Qwen/Qwen3.6-27B) |
| `mistralai/mistral-nemo-instruct-2407` (Q4_K_M) | Medium-low | High | Officially supports function calls, 128k context and has no moderation mechanisms. This is the best installed extractor candidate even though it is older and less capable than current 14B/24B instruct models. [Official card](https://huggingface.co/mistralai/Mistral-Nemo-Instruct-2407) |

## Hardware consequence

The target machine has an RTX 5060 Ti with 16 GB VRAM, a Ryzen 5 5600X and 64 GB system RAM.

- The installed Melody 26B Q4 file is about 16.8 GB before KV cache and runtime overhead, so it cannot be wholly resident in 16 GB VRAM. Partial CPU/RAM offload is expected even though the short local Capsule result was fast (3.9 seconds).
- The installed Mistral Nemo Q4 is about 7.5 GB and is a comfortable extractor fit.
- Painted Fantasy 24B Q4_K_M is about 14.3 GB. It leaves limited VRAM for context/cache, but is the most promising new writer that is close to full-GPU fit. Test it initially at a practical 16k-32k context rather than reserving a huge window.
- Phr00tyMix v4 32B Q4 is about 19.8 GB, so it necessarily needs more CPU offload. Its creator only claims that the merge improves v3's instruction following/coherence while remaining creative and uncensored; no relevant benchmark is supplied. It is lower priority than Painted Fantasy on this hardware. [Creator model card](https://huggingface.co/Phr00t/Phr00tyMix-v4-32B)
- A 24B-27B writer and a 12B-14B extractor will not both fit fully in 16 GB VRAM. Run extraction on the explicit review/scene-boundary button with sequential model loading, keep the smaller worker CPU-offloaded, or use a second inference process/device. Do not make model swapping part of every narration turn.

## Stronger extractor candidates to screen

These are state workers, not suggested replacements for the adult-roleplay writer.

### 1. Ministral 3 14B Instruct 2512

Best current paper fit. Mistral claims strong system adherence, native JSON output and function calling, a 256k context window, and local deployment after quantization. It has a separate instruct variant, so there is no reason to spend state-update latency on a reasoning model. Start at temperature 0-0.1. Unknown: behavior when the source passage is extremely explicit. [Official model card](https://huggingface.co/mistralai/Ministral-3-14B-Instruct-2512)

### 2. Qwen2.5 14B Instruct

Older but operationally attractive: it is non-thinking, Apache 2.0, and Qwen explicitly highlights instruction following, structured-data understanding, JSON output, diverse system prompts and roleplay condition-setting. It supports 128k context. Unknown: whether its alignment interferes with extracting facts from explicit scenes. [Official model card](https://huggingface.co/Qwen/Qwen2.5-14B-Instruct)

### 3. Mistral Small 24B Instruct 2501

Larger fallback if 14B accuracy is insufficient. Mistral reports native JSON output, function calling, strong system-prompt adherence and a 32k window; its creator benchmark reports IFEval 0.829. It is quantizable for local use, but costs more memory and is unnecessary unless the 12B/14B workers fail real fixtures. [Official model card](https://huggingface.co/mistralai/Mistral-Small-24B-Instruct-2501)

## Other writer worth a later A/B test

`anthracite-org/magnum-v4-22b` is a 22B Mistral Small fine-tune whose stated goal is to reproduce Claude 3 Sonnet/Opus prose quality; its training metadata includes no-refusal writing datasets. This is a plausible creative-writing challenger, not a proven structured state worker. Its Mistral Research License also matters for anything beyond personal use. [Creator model card](https://huggingface.co/anthracite-org/magnum-v4-22b)

Do not download it merely from its description. First compare the three already installed serious writer candidates: Melody 26B v2, Gemma 4 StyleTune Heretic, and Mistral Small 22B RPMax.

### Painted Fantasy v4 24B

This is the strongest **new** writer candidate for the actual hardware. The card says the model is intended for uncensored creative RP/ERP, that 90% of its SFT data is non-thinking, and that its SFT corpus includes SFW/NSFW RP, stories, NSFW writing prompts, creative instruction and chat data. DPO additionally includes general assistant/chat preferences and security data; the creator says this traded a little creativity for better logic. It uses Mistral v7 Tekken and supplies SillyTavern sampler guidance. This combination is unusually close to the user's desired middle ground, but the card supplies no instruction-following or structured-extraction benchmark. Treat it as a writer first and keep the separate extractor. [Creator model card](https://huggingface.co/zerofata/MS3.2-PaintedFantasy-v4-24B)

## Recommended runtime design

### Narration call

- Keep the selected roleplay writer in SillyTavern.
- Give it the compact Campaign Capsule as ordinary labeled prose using the exact format that passed that model’s profile.
- Ask only for the next scene response. Do not ask it to append JSON, XML, checks or campaign mutations.
- Use the writer creator’s recommended creative sampler as a starting point, then save the working preset under the exact model ID.

### Review-changes call

- Run on the explicit **Review changes** button or scene boundary, not necessarily after every message. This reduces model swapping and makes the operation understandable.
- Send the extractor only: the unprocessed chat slice, current relevant records, a small change schema and explicit rules to omit uncertain changes.
- Request one machine object containing evidence spans and proposed operations. Validate the object locally; never apply prose from the model directly.
- Retry once with a compact repair prompt only when parsing fails. Do not silently broaden the scan window or invent defaults.
- Show every proposal in editable controls. User confirmation remains the authority.

### Forward-scene call

- First run the same extractor on the closing slice.
- Let the user edit/approve the changes.
- Then give the writer a compact transition brief and ask for the next fitting scene.
- Do not make one generation close the scene, mutate the database and narrate the next scene simultaneously.

This split is especially useful for 20-40B local models: it removes competing objectives, permits different temperatures, bounds latency, and lets the application reject malformed state proposals without discarding good prose.

## Decision test before changing the default

Model cards are marketing plus limited creator evaluations. The project should choose from real play traces.

### Writer screen

Run Melody 26B v2, Gemma 4 StyleTune Heretic, Mistral Small 22B RPMax and Painted Fantasy v4 24B on the same eight private prompts:

- quiet dialogue;
- combat/action;
- emotionally subtle conflict;
- explicit consensual adult scene;
- grotesque or transgressive fictional scene;
- long-context callback;
- strict character-voice constraint;
- “do not narrate the player’s choice” constraint.

Blind-rank prose preference, character consistency, repetition, unwanted moralizing/refusal, player agency violations and latency. A context-format score is not a writing-quality score.

### Extractor screen

Use at least 20 short chat fixtures, including explicit prose. Measure:

- valid-object rate;
- exact supported changes found;
- invented changes;
- missed removals and reversals;
- preservation of IDs/enums;
- latency and visible final-answer rate;
- refusal or sanitization caused by adult content.

Start with installed Mistral Nemo 12B. Only download Ministral 3 14B or Qwen2.5 14B if Nemo fails the agreed accuracy threshold. The best extractor is the smallest non-thinking model that passes these fixtures consistently.

## Recommendation status

- **Adopt now for experiments:** Melody 26B v2 as writer; Mistral Nemo 12B as extractor.
- **Download next for the writer A/B:** Painted Fantasy v4 24B Q4_K_M.
- **Keep as installed writer challengers:** Gemma 4 StyleTune Heretic; Mistral Small 22B RPMax; Melody 27B after a no-thinking readiness check.
- **Do not use for campaign automation now:** both locally tested Qwen3.5/Qwen3.6 reasoning-only artifacts, Dirty Muse, or Crow.
- **Download next only if justified by extractor fixtures:** Ministral 3 14B Instruct 2512, then Qwen2.5 14B Instruct.

All recommendations beyond the cited model-card facts are inferences from task fit plus the project’s local screening evidence. No public model card establishes reliable performance on this project’s exact combination of explicit roleplay, contradiction rejection and structured Campaign mutations.
