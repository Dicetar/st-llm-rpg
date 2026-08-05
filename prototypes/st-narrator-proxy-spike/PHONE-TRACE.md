# Physical-phone proxy evidence trace

This is the final human gate for Wayfinder #20. It must be run in the real Android browser at roughly 360 CSS pixels. Desktop emulation does not count.

The bridge recorder is intentionally redacted. Its JSON report contains fixed `PHONE_*` sentinel counts, message counts/roles, swipe structure, sanitized proxy stages and timings, viewport/browser/path metadata, and optional wording notes. It does **not** include chat prose, prompts, Campaign data, Chat/Binding/Request IDs, hashes, locators, or generated text.

## Prepare

1. Pull current `main`.
2. Start the throwaway proxy:

   ```powershell
   npm run prototype:proxy
   ```

3. Reload project-local SillyTavern on desktop and phone so bridge version `0.1.3` is installed.
4. Keep SillyTavern Custom Chat Completions pointed to:

   ```text
   http://127.0.0.1:8002/v1
   ```

5. On desktop, open **RPG Narrator Proxy Spike**, read the displayed eight-character `host` prefix, and leave the proxy running.
6. On the physical phone, open SillyTavern through the trusted LAN or VPN hostname. Use portrait orientation. Open a disposable saved character chat.
7. Open **Proxy physical-phone evidence** in Extensions settings. Select LAN or VPN and enter the desktop host prefix.

The recorder refuses a final PASS when the desktop host prefix is absent/mismatched, required environment fields are absent, or the CSS viewport width is outside 300–430 pixels.

## Run and record

After each action, return to **Proxy physical-phone evidence**, choose the matching step, optionally enter the observed toast/error wording, and tap **Record current step**.

### 1. Linked normal

- Tap **Fixture**.
- Tap **Link this chat**.
- Send a normal disposable user message.
- Confirm the assistant result is `PHONE_NORMAL`.
- Record **Linked normal**.

### 2. Regenerate

- Use SillyTavern Regenerate on that assistant message.
- Confirm the selected result is `PHONE_REGENERATE`.
- Record **Linked regenerate**.

### 3. Continue

- Use SillyTavern Continue.
- Confirm `PHONE_CONTINUE` is appended to the selected assistant message.
- Record **Linked continue**.

### 4. Swipe

- Use SillyTavern Swipe to request/select an alternative.
- Confirm the alternative contains `PHONE_SWIPE` and the message has multiple swipe candidates.
- Record **Linked swipe**.

### 5. Stop before atomic delivery

- Tap **10 s Stop delay**.
- Send once, then press SillyTavern Stop before ten seconds.
- Wait beyond ten seconds and confirm no `PHONE_DELAYED_NORMAL` assistant appears.
- Record **Linked Stop during 10 s delay**.

### 6. Linked Campaign outage

- Tap **Campaign outage** while the chat remains linked.
- Send once.
- Confirm the user turn remains as the final chat message and no assistant result appears.
- Record **Linked Campaign outage**.

### 7. Explicit unlinked outage bypass

- Leave Campaign outage enabled.
- Tap **Make this chat unlinked**.
- Send once.
- Confirm the assistant result is `PHONE_OUTAGE_NORMAL`.
- Record **Explicit unlinked during outage**.

## Export

The recorder summary must show:

```text
7/7 captured · 7 passing · final verdict PASS
```

Tap **Copy evidence JSON** and paste the complete JSON into the chat. The report can be inspected and committed as sanitized evidence. After the report passes, the saved disposable chat JSONL is audited one final time for routing headers, delayed Stop output, and blocked outage output before #20 closes.

## Focused test

```powershell
npm run test:proxy-phone-evidence
```

This verifies redaction, generation-mode selection, sentinel checks, Stop/outage semantics, host-prefix verification, phone viewport enforcement, and complete-report requirements. It does not replace the physical-phone run.
