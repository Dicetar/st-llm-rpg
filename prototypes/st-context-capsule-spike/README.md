# THROWAWAY PROTOTYPE — Context Capsule model lab

## Question

Which small, deterministic Campaign context format and placement does the user's actual 20–40B SillyTavern model follow most reliably when recent prose contradicts inventory, ability, quest, and NPC facts? Which variants leak context markup into narration?

The lab runs six short invisible generations through SillyTavern's active connection. It does not add messages to the chat or change Campaign state. One run is screening evidence, not a final benchmark; the best two variants must later be repeated across representative scenes and both completion families.

## Install

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File prototypes/st-context-capsule-spike/install.ps1
```

Refresh SillyTavern, confirm the desired local model is connected, and press the floating gold **C** button. The comparison uses up to six generations of 220 response tokens each. **Stop** uses SillyTavern's normal generation cancellation.

## What is compared

- plain labeled sections, XML-like markup, and compact line records;
- context at the beginning as a system instruction;
- context near the latest request as a system message;
- context near the latest request as a user message;
- factual adherence, conflict rejection, markup leakage, latency, and captured outgoing prompt shape.

The lab deliberately avoids provider-native structured output and tool calls.
