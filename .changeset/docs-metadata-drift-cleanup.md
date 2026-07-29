---
'hotcrm': patch
---

Re-sync STATUS/README and internal docs with the source tree; remove dead dashboard actions and stale metadata.

`docs/STATUS.md` was still reporting a `v1.0.5` validation block (15 objects / 296 fields / 10 actions / 16 flows / 2 agents), version `1.3.0`, Node `>=20`, and ObjectStack `^7.7.0`; the README badge said `1.0.0` and its counts still included the two retired copilot agents. Both are regenerated from what `pnpm validate` actually reports (v2.2.2 — 16 objects / 318 fields / 22 flows / 12 actions / 13 views / 8 pages / 12 positions, skills-only AI). `docs/ARCHITECTURE.md` drops the retired agents/`ai`-capability/role-hierarchy claims, `docs/RELEASE_STRATEGY.md` states the current version, and `docs/developers/api_reference.md` gains `crm_competitor` plus the renamed `crm_competitors` opportunity field.

Dead metadata removed: all 16 widget-level `actionUrl`/`actionType`/`actionIcon` triples across the four dashboards pointed at dead routes flagged by `pnpm validate` (unregistered reports, `/objects/*` paths missing the `crm_` prefix) — validation is now warning-free; the unreferenced empty `src/interfaces/` barrel is deleted; the already-shipped `no-hardcoded-currency-format` changeset is folded into the 2.2.0 release notes; a stale `objectstack.config.ts` comment pointing at a non-existent flow file is corrected.
