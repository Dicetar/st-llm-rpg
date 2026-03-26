# 02 — Repository Layout

## Recommended repository root

```text
D:\Projects\narrative-engine\
```

## Full layout

```text
narrative-engine/
  docs/
    00_decision.md
    01_target_architecture.md
    02_repository_layout.md
    03_domain_model.md
    04_command_engine.md
    05_backend_api_contract.md
    06_st_integration_plan.md
    07_lm_studio_integration.md
    08_journaling_and_scene_state.md
    09_implementation_steps.md
    10_test_plan.md
    11_risk_register.md
    12_migration_from_current_files.md

  backend/
    README.md
    app/
      main.py
      api/
      core/
      db/
      models/
      services/
      repositories/
      prompts/
      tests/
    alembic/
    pyproject.toml

  frontend-extension/
    README.md
    extension/
      manifest.json
      index.js
      style.css
      panels/
      commands/
      api/
      state/
      templates/

  shared/
    schemas/
      command_request.schema.json
      command_result.schema.json
      post_turn_updates.schema.json

  prompts/
    narrator_system_prompt.md
    extractor_system_prompt.md

  campaigns/
    example_campaign/
      campaign_config.json
      cast_registry.json
      world/
      lore/
      quests/
      scenes/
      imports/

  data/
    runtime/
    exports/
    logs/
```

## Where each category goes

### `docs/`
Human-readable planning and implementation notes. Keep these under version control.

### `backend/`
The actual authoritative engine.

### `frontend-extension/`
The SillyTavern extension code and UI assets.

### `shared/schemas/`
Contracts shared by frontend, backend, and model prompts.

### `prompts/`
Prompt templates used by the backend when calling LM Studio.

### `campaigns/`
Campaign-specific content and importable source files.

### `data/`
Generated runtime files, exports, logs, and local developer artifacts.
