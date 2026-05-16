## Sentinel — Chronicle Coverage Map — 2026-W20

| Module | Coverage | Entries | Files | PR Changes | Risk |
|--------|----------|---------|-------|------------|------|
| council/ | 0% | 0 | 8 | — | high |
| jury/ | 0% | 0 | 4 | — | high |
| oracle/ | 22% | 4 | 9 | — | medium |
| **scripts/** | 0% | 0 | 1 | **1 files** | high |
| **sentinel/** | 0% | 0 | 5 | **2 files** | high |
| shared/ | 100% | 2 | 1 | — | low |
| (root)/ | 0% | 0 | 1 | — | high |

```mermaid
flowchart TD
    classDef high fill:#fca5a5,stroke:#dc2626
    classDef medium fill:#fde68a,stroke:#d97706
    classDef good fill:#bbf7d0,stroke:#16a34a
    Chronicle[(Chronicle)]
    Chronicle --> council["council — 0%"]:::high
    Chronicle --> jury["jury — 0%"]:::high
    Chronicle --> oracle["oracle — 22%"]:::medium
    Chronicle --> scripts["scripts — 0% — 1 changed"]:::high
    Chronicle --> sentinel["sentinel — 0% — 2 changed"]:::high
    Chronicle --> shared["shared — 100%"]:::good
    Chronicle --> _root_["(root) — 0%"]:::high
```

---
*Risk: high = 0% coverage, medium = 1-49%, low = 50%+*