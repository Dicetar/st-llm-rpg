# Example usage

## Example 1 — consume a potion

Command in SillyTavern:

`/use_item health potion`

Expected flow:

1. extension sends `/use_item [health potion]` to backend
2. backend checks inventory
3. if available and useful, quantity decreases
4. backend returns mutation details
5. extension refreshes state panel
6. extension stores narration block
7. next generation narrates the potion use

## Example 2 — cast a spell

Command:

`/cast suggestion`

Expected flow:

1. backend verifies the spell exists
2. backend verifies the spell slot exists
3. backend decrements slot count
4. narration block states the slot is already spent
5. model narrates the act of casting without inventing different resource usage

## Example 3 — inspect current quests

Command:

`/quest`

Expected flow:

1. extension fetches current quest state
2. command returns a structured snapshot for the model
3. no mutation occurs

## Example 4 — multi-command turn

Recommended form:

`/use_item health potion | /cast suggestion`

This depends on your exact ST slash-command pipeline behavior.
If your local build does not like chaining these directly, use them one by one for the first prototype.
