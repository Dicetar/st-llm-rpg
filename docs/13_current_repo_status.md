# 13 - Current Repository Status

This repository contains a **working prototype slice**, not a complete production system.

Already present:
- FastAPI backend with authoritative state reads, command execution, stable turn contracts, lorebook sync, event logging, journal APIs, `resolve-turn`, scene open/close endpoints, and draft-only scene summary support
- SQLite-backed runtime persistence bootstrapped from tracked seed data
- JSON repository retained as a reference implementation for parity testing
- command parser and command handlers for `/inventory`, `/use_item`, `/cast`, `/equip`, `/quest`, `/journal`, `/condition`, `/new`, `/new_item`, `/new_spell`, and `/new_custom_skill`
- broader quest and relationship commands for manual continuation work, including `quest_update`, `relationships`, and `relationship_note`
- scene upkeep commands for manual continuation work, including `scene_move`, `scene_object`, `scene_clue`, `scene_hazard`, and `scene_discovery`
- optional rollback-on-failure command policy for atomic multi-command turns
- safe extraction flow that auto-applies only approved categories, skips no-op proposals, and stages unsafe or invalid proposals into events/journal entries with reasons
- non-fatal `resolve-turn` warning handling so narrator/extractor failures no longer hide already-applied backend state behind a hard API failure
- scene archive workflow with summary journaling, durable fact promotion, and LM-drafted close summaries that require user confirmation
- SillyTavern bridge with overview, scene, scene lifecycle controls, inventory, quests, relationships, journal, events, builder tools, inspector views, backend connector, pending narration injection, and optional backend-resolved normal turns
- regression tests for command parity, dry-run behavior, turn resolution, extraction, scene lifecycle, draft non-mutation, scene attribution, and mixed-turn failure summaries
- architecture and migration docs that now distinguish current state from next milestones

Still expected in the next phase:
- live SillyTavern smoke validation of the split bridge and `resolve-turn` path
- continued live validation around prompt/extraction edge cases as real play traces produce new model-output shapes
- optional transport/UX work such as live sync once the current contract stops moving
