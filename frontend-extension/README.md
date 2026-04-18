# SillyTavern Extension Notes

This folder contains the SillyTavern-side bridge for the project.

## Responsibility of the extension

- render RPG panels and inspector views
- register slash commands
- call the backend API
- present authoritative command results and errors
- inject pending narration context before generation

## Keep out of the extension

- canonical state mutations without backend confirmation
- inventory truth
- spell slot truth
- scene archive truth
- repository or persistence rules

## Structure

- `llm-rpg-bridge/manifest.json` keeps the stable extension entrypoint
- `llm-rpg-bridge/index.js` is a thin loader
- `llm-rpg-bridge/scripts/` contains the split bridge implementation

## Install and enable

See:

- `docs/01_where_to_put_files.md`
- `docs/02_install_and_enable.md`
