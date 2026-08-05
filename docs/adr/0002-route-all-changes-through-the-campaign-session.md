# Route all changes through the Campaign Session

Forms, inline actions, Story Sync approvals, Advance Scene, imports, and any compatibility adapters submit typed Campaign Operations through one Campaign Session module. The module validates references and revisions, applies the change atomically, appends the Campaign Event, compiles the matching Context Capsule, and coordinates durable acknowledgement. This rejects direct JSON mutation and command-string intermediates so every caller receives the same invariants and failure behavior.
