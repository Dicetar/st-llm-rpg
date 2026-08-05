# Proxy spike launcher rerun behavior

`npm run prototype:proxy` is intentionally idempotent.

- It installs the complete bridge module graph required by the current manifest.
- If `http://127.0.0.1:8002/prototype/state` identifies the existing throwaway narrator proxy, the launcher reuses that process and exits successfully.
- If another or unhealthy process owns port 8002, the launcher reports the listening PID, executable, and command line when Windows exposes them.
- The launcher never stops an existing process automatically.

This keeps the physical-phone evidence setup safe to repeat after pulling bridge changes while preserving explicit ownership of port 8002.
