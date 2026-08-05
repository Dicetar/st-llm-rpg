# Separate Campaign authority from Chat Bindings

Status: accepted.

A Campaign is durable RPG truth independent from SillyTavern chats; a Chat Binding explicitly associates one chat with one Campaign and owns only chat-specific state. Copied chats, stale bindings, and revision mismatches never choose, overwrite, or branch Campaign state automatically: they pause the affected workflow and ask for an explicit reconciliation choice. This costs a visible binding lifecycle but allows one Campaign to survive chat replacement, deliberate branching, multiple devices, and independent backup without treating chat metadata as ownership.

This supersedes the former one-chat **Campaign**, chat-owned **Lineage**, and Campaign-global **Sync Boundary** definitions in [the glossary](../../CONTEXT.md), plus the deferred cross-chat ownership assumption in [Canonical Campaign Model v1](../design/campaign-model-v1.md). SillyTavern cards continue to own narrator and chat configuration; the Campaign owns canonical player, NPC, appearance, inventory, ability, quest, world, and relationship state.
