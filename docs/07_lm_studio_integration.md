# 07 — LM Studio Integration

## Role of LM Studio
LM Studio should provide:
- narration
- structured extraction of factual post-turn updates
- optional summary generation

## Recommended call pattern

### Step 1 — command execution
Frontend sends command batch to backend.
Backend validates and commits changes.
Backend builds `narration_context`.

### Step 2 — narration call
Backend calls LM Studio with:
- narrator system prompt
- current scene summary
- command execution results
- relevant campaign context
- any recent summaries

### Step 3 — optional extraction call
After receiving prose, backend may call either:
- the same model
- or a smaller helper model

for structured extraction using the extractor prompt.

### Step 4 — validation
Backend validates extracted updates.
Only safe factual updates are auto-applied.

## Recommended endpoint style
Use LM Studio’s OpenAI-compatible server so the backend can call it like a standard chat-completions endpoint.

## Recommended first model split
- one stronger narrator model
- one cheaper extractor model or the same narrator reused if hardware is limited

## Keep the narrator honest
Always include authoritative command results in the narration prompt.
That prevents the model from narrating impossible state changes.
