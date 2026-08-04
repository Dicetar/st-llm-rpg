# Domain Docs

Before exploring, read root `CONTEXT.md` when present and applicable decisions under `docs/adr/`.

This repository uses a single-context layout:

```text
/
├── CONTEXT.md
├── docs/adr/
└── src/
```

Create domain documents lazily as terms and decisions are resolved. Use glossary vocabulary consistently. If proposed work conflicts with an ADR, state that conflict explicitly instead of silently overriding it.
