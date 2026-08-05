# Physical-phone proxy test

This is the final human gate for Wayfinder #20. Run it in the real Android browser at roughly 360 CSS pixels. Desktop emulation does not count.

## Start

On Windows:

```powershell
npm run test:proxy-phone-evidence
npm run prototype:proxy
```

Close and reopen SillyTavern on Android so bridge version `0.1.6` loads. Open one disposable saved character chat, then open Extensions → **Phone proxy test**.

Leave your normal Custom Chat Completions endpoint unchanged. The bridge redirects only each test request through the proxy and does not alter the saved profile.

## Use the three buttons

1. Tap **Prepare next test**.
2. Perform the single SillyTavern action shown under **Next**.
3. Return to Extensions and tap **Capture result**.
4. Repeat until the panel shows:

```text
7/7 captured · 7 passing · PASS
```

The sequence is:

1. Send one normal message. Expected reply: `PHONE_NORMAL`.
2. Use Regenerate. Expected reply: `PHONE_REGENERATE`.
3. Use Continue. Expected appended text: `PHONE_CONTINUE`.
4. Generate a swipe. Expected alternative: `PHONE_SWIPE`.
5. Send and press Stop before ten seconds. No delayed assistant may appear.
6. Send once while linked and Campaign is offline. The user turn remains; no assistant appears.
7. Send once after the test makes the chat explicitly unlinked. Expected reply: `PHONE_OUTAGE_NORMAL`.

**Prepare next test** automatically selects fixture mode, links or unlinks the disposable chat, enables the Stop delay, and enables Campaign outage when required.

When the panel shows PASS, tap **Copy PASS JSON** and paste it into the ChatGPT conversation.

The JSON contains fixed `PHONE_*` sentinel counts, structural chat results, sanitized proxy outcomes, viewport, browser, and LAN/VPN path. It excludes ordinary chat prose, prompts, Campaign data, IDs, hashes, locators, and generated text.
