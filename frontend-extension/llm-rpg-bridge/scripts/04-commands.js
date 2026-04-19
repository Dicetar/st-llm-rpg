async function resolveSlashApi() {
  if (globalThis.SlashCommandParser && globalThis.SlashCommand && globalThis.SlashCommandArgument && globalThis.ARGUMENT_TYPE) {
    return {
      SlashCommandParser: globalThis.SlashCommandParser,
      SlashCommand: globalThis.SlashCommand,
      SlashCommandArgument: globalThis.SlashCommandArgument,
      SlashCommandNamedArgument: globalThis.SlashCommandNamedArgument,
      ARGUMENT_TYPE: globalThis.ARGUMENT_TYPE,
    };
  }

  async function importMaybe(path) {
    try {
      return await import(/* webpackIgnore: true */ path);
    } catch (error) {
      warn(`Failed to import ${path}`, error);
      return null;
    }
  }

  const parserMod = await importMaybe('/scripts/slash-commands/SlashCommandParser.js');
  const cmdMod = await importMaybe('/scripts/slash-commands/SlashCommand.js');
  const argMod = await importMaybe('/scripts/slash-commands/SlashCommandArgument.js');
  const namedArgMod = await importMaybe('/scripts/slash-commands/SlashCommandNamedArgument.js');
  const commonEnumMod = await importMaybe('/scripts/slash-commands/SlashCommandCommonEnumsProvider.js');

  return {
    SlashCommandParser: parserMod?.SlashCommandParser || globalThis.SlashCommandParser,
    SlashCommand: cmdMod?.SlashCommand || globalThis.SlashCommand,
    SlashCommandArgument: argMod?.SlashCommandArgument || globalThis.SlashCommandArgument,
    SlashCommandNamedArgument: namedArgMod?.SlashCommandNamedArgument || globalThis.SlashCommandNamedArgument,
    ARGUMENT_TYPE: commonEnumMod?.ARGUMENT_TYPE || globalThis.ARGUMENT_TYPE,
  };
}

function stringifyExecutionSummary(apiResponse) {
  return buildNarrationBlock(apiResponse);
}

async function commandCallback(commandName, rawArgument) {
  const bracketed = rawArgument.includes('[') ? rawArgument : `[${rawArgument}]`;
  const rawText = `/${commandName} ${bracketed}`.trim();
  const apiResponse = await executeAgainstBackend(rawText);
  notify(`/${commandName} resolved against backend.`, 'success');
  return stringifyExecutionSummary(apiResponse);
}

async function resolveTurnCommandCallback(rawText) {
  const trimmed = String(rawText ?? '').trim();
  if (!trimmed) {
    throw new Error('/rpg_resolve requires narrative text.');
  }
  const apiResponse = await resolveTurnAgainstBackend(trimmed, {
    includeExtraction: Boolean(getSettings().includeExtractionOnResolveTurn),
  });
  notify('Narrative turn resolved against backend.', 'success');
  return apiResponse.prose || '';
}

async function registerSlashCommands() {
  const api = await resolveSlashApi();

  if (!api?.SlashCommandParser || !api?.SlashCommand || !api?.SlashCommandArgument) {
    warn('Slash command API was not resolved. Panel will still work, but slash commands were not registered.');
    return;
  }

  const add = api.SlashCommandParser.addCommandObject?.bind(api.SlashCommandParser);
  const make = api.SlashCommand.fromProps?.bind(api.SlashCommand);
  const Arg = api.SlashCommandArgument;
  const ARGUMENT_TYPE = api.ARGUMENT_TYPE || { STRING: ['string'] };

  const commands = [
    ['inventory', 'Return authoritative inventory snapshot from backend.'],
    ['use_item', 'Apply an item use against backend state and return a narration block.'],
    ['cast', 'Apply spell-slot spending and return a narration block.'],
    ['equip', 'Apply equipment change and return a narration block.'],
    ['quest', 'Return current quest information from backend.'],
    ['relationships', 'Return current relationship records from backend.'],
    ['journal', 'Return journal guidance from backend.'],
    ['lorebook', 'Return backend-built keyword insertion lorebook entries.'],
    ['session_summary', 'Record a session summary and rebuild lorebook insertion entries.'],
    ['condition', 'Add or remove an actor condition through the authoritative backend command contract.'],
    ['quest_update', 'Create or update a quest note, and optionally status and stage.'],
    ['relationship_note', 'Create or update a relationship note, and optionally adjust score.'],
    ['scene_move', 'Update the active scene location and optional scene id, time of day, or tension level.'],
    ['scene_object', 'Create or update a notable scene object and its metadata.'],
    ['scene_clue', 'Add or remove a visible clue from the active scene.'],
    ['scene_hazard', 'Add or remove an active hazard from the active scene.'],
    ['scene_discovery', 'Add or remove a recent discovery from the active scene.'],
    ['scene_draft_close', 'Draft a close-scene summary through the backend without mutating state.'],
    ['scene_open', 'Open a new active scene through the scene lifecycle endpoint.'],
    ['scene_close', 'Close and archive the active scene through the scene lifecycle endpoint.'],
    ['actor', 'Return richer actor detail from backend.'],
    ['campaign', 'Return campaign detail from backend.'],
    ['scene', 'Return current scene detail from backend.'],
    ['new', 'Builder command for new item, spell, or custom skill.'],
    ['new_item', 'Create or update an inventory item and registry entry.'],
    ['new_spell', 'Create or update a known spell and spell registry entry.'],
    ['new_custom_skill', 'Create or update a custom skill and note entry.'],
    ['rpg', 'Namespaced RPG command proxy. Example: /rpg actor or /rpg new item :: rope :: 2 :: tool :: 50 feet of rope.'],
    ['rpg_resolve', 'Resolve a full narrative turn through the backend narration endpoint.'],
    ['rpg_refresh', 'Refresh the bridge panel from the backend.'],
  ];

  for (const [name, description] of commands) {
    try {
      if (name === 'rpg_refresh') {
        add(make({
          name,
          callback: async () => {
            await refreshPanel();
            return 'RPG bridge panel refreshed.';
          },
          returns: 'confirmation text',
          unnamedArgumentList: [],
          helpString: description,
        }));
        continue;
      }

      if (name === 'rpg_resolve') {
        add(make({
          name,
          callback: async (_namedArgs, unnamedArgs) => {
            const text = Array.isArray(unnamedArgs) ? unnamedArgs.join(' ') : String(unnamedArgs ?? '');
            return await resolveTurnCommandCallback(text);
          },
          returns: 'backend-resolved narration',
          unnamedArgumentList: [
            Arg.fromProps({
              description: 'narrative player input to resolve through the backend',
              typeList: ARGUMENT_TYPE.STRING,
              acceptsMultiple: true,
              isRequired: true,
            }),
          ],
          helpString: description,
        }));
        continue;
      }

      add(make({
        name,
        callback: async (_namedArgs, unnamedArgs) => {
          const text = Array.isArray(unnamedArgs) ? unnamedArgs.join(' ') : String(unnamedArgs ?? '');
          if (!text.trim() && MUTATION_COMMANDS.has(name)) {
            throw new Error(`/${name} requires an argument.`);
          }
          return await dispatchRegisteredCommand(name, text);
        },
        returns: 'authoritative RPG command narration block',
        unnamedArgumentList: [
          Arg.fromProps({
            description: 'command target, item name, spell name, or other payload',
            typeList: ARGUMENT_TYPE.STRING,
            acceptsMultiple: true,
            isRequired: false,
          }),
        ],
        helpString: description,
      }));
      log(`Registered slash command /${name}`);
    } catch (error) {
      warn(`Failed to register /${name}. This usually means the command already exists or ST internals changed.`, error);
    }
  }
}

function injectPendingNarration(chat) {
  const settings = getSettings();
  if (!settings.injectNarrationBlockIntoChat) return;
  const pending = getPendingNarrationContext();
  if (!pending?.narration_block) return;

  const systemNote = {
    is_user: false,
    is_system: true,
    name: 'RPG Bridge',
    send_date: Date.now(),
    mes: pending.narration_block,
  };

  const insertionIndex = Math.max(0, chat.length - 1);
  chat.splice(insertionIndex, 0, systemNote);
}

function getLatestNarrativeUserTurn(chat) {
  for (let index = chat.length - 1; index >= 0; index -= 1) {
    const message = chat[index];
    if (!message || message.is_system || message.is_user !== true) continue;
    const text = String(message.mes ?? '').trim();
    if (!text || text.startsWith('/')) return null;
    return {
      text,
      key: `${message.send_date || index}:${text}`,
    };
  }
  return null;
}

globalThis.llmRpgBridgeInterceptor = async function(chat, _contextSize, abort, type) {
  const pending = getPendingNarrationContext();
  if (pending) {
    try {
      injectPendingNarration(chat);
      await clearPendingNarrationContext();
      log('Injected pending narration context into chat before generation.');
    } catch (error) {
      warn('Failed to inject pending narration context.', error);
    }
    return;
  }

  if (type !== 'normal' || !getSettings().resolveNarrativeTurns) return;

  const latestTurn = getLatestNarrativeUserTurn(chat);
  if (!latestTurn) return;
  if (getResolvedTurnKey() === latestTurn.key) return;

  try {
    await resolveTurnAgainstBackend(latestTurn.text, {
      includeExtraction: Boolean(getSettings().includeExtractionOnResolveTurn),
      chatMessages: chat,
    });
    await setResolvedTurnKey(latestTurn.key);
    if (typeof abort === 'function') {
      abort(true);
    }
    log('Resolved narrative turn through backend and aborted local generation.');
  } catch (error) {
    warn('Failed to resolve narrative turn through backend.', error);
    notify(error.message || 'Backend resolve-turn failed; local generation will continue.', 'error');
  }
};

async function bootstrap() {
  try {
    getSettings();
    mountPanel();
    injectUiPatchStyles();
    await registerSlashCommands();
    if (getSettings().autoRefreshOnLoad) {
      await refreshPanel().catch(error => warn('Initial refresh failed.', error));
    }
    notify('LLM RPG Bridge loaded.', 'success');
  } catch (error) {
    warn('Failed to initialize extension.', error);
    notify(`LLM RPG Bridge failed to initialize: ${error.message}`, 'error');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
