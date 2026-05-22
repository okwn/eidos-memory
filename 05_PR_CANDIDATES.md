# Phase 6 — PR Candidate Backlog: eidos-memory

## Candidate List

---

### CANDIDATE 1: Add Config Schema Validation

**candidate_id:** eidos-001  
**title:** Add JSON Schema Validation for eidos.config.json  
**category:** reliability / config  
**linked_issue:** inferred — config silently ignored on parse errors  
**problem:** Both `loadAutoConfig()` (server.ts) and `loadConfig()` (assemble_context.ts) silently swallow all JSON parse errors and return hardcoded defaults. Users with typos in their config don't know their settings are ignored.  
**proposed_solution:** Add a simple validation function that checks required fields and types. Warn users when config is ignored. Optionally use a schema (Joi-style or manual) to validate at startup.  
**target_files:**
- `src/mcp/server.ts` — `loadAutoConfig()`
- `src/mcp/tools/assemble_context.ts` — `loadConfig()`
- Add `src/engine/config_schema.ts` for shared validation logic

**test_plan:**
1. Create test with malformed config JSON — should warn, not silently use defaults
2. Create test with missing required fields — should warn
3. Valid config should still work unchanged

**risk_level:** Low  
**expected_diff_size:** ~150-200 lines  
**merge_likelihood:** High — purely additive, no breaking changes  
**maintainer_discussion_needed:** Yes — should warn on invalid config or silently ignore? Preference?

---

### CANDIDATE 2: Add Structured Logging with Log Levels

**candidate_id:** eidos-002  
**title:** Replace console.error with Structured Logger  
**category:** observability / developer-experience  
**linked_issue:** inferred — all logging goes to stderr via console.error  
**problem:** All logging uses `console.error` with hardcoded strings. No log levels, no way to filter by category, no JSON output for machine parsing. Hard to debug production issues.  
**proposed_solution:** Create a lightweight logger utility (env-based `EIDOS_LOG_LEVEL=debug|info|warn|error`). Replace `console.error` calls with structured `logger.info/warn/error`. Keep console output for CLI commands.  
**target_files:**
- `src/engine/logger.ts` (new)
- `src/mcp/server.ts`
- `src/engine/embedding.ts`
- `src/store/db.ts`
- `src/mcp/tools/assemble_context.ts`
- `src/mcp/tools/index_project.ts`

**test_plan:**
1. Verify existing console.error calls now route through logger
2. Verify log level filtering works
3. Verify no breaking changes to existing output

**risk_level:** Low  
**expected_diff_size:** ~200-300 lines (new file + updates)  
**merge_likelihood:** High — additive, no breaking changes  
**maintainer_discussion_needed:** No — straightforward improvement

---

### CANDIDATE 3: Add Vector Search Failure Warning

**candidate_id:** eidos-003  
**title:** Warn Users When Vector Search Fails to Initialize  
**category:** reliability / observability  
**linked_issue:** inferred — `insertVec`/`searchVec` silently catch errors, VSS failures go unnoticed  
**problem:** When sqlite-vec or sqlite-vss fails to load or throws during insert/search, errors are silently caught. Users may believe vector search is working when it's fallen back to linear scan (or no results).  
**proposed_solution:** Add a flag `_vssWarningLogged` that emits a one-time warning when VSS first fails, so users know vector search degraded. Use the existing `getVecBackend()` to report which backend is active.  
**target_files:**
- `src/store/vector.ts` — add warning on first failure
- `src/store/db.ts` — report backend in `getDb()` initialization

**test_plan:**
1. Test that warning appears when vec/vss extensions fail to load
2. Test that warning does NOT appear when VSS loads successfully
3. Verify fallback to linear search still works

**risk_level:** Low  
**expected_diff_size:** ~50-80 lines  
**merge_likelihood:** High — small targeted fix  
**maintainer_discussion_needed:** No

---

### CANDIDATE 4: Add Config Migration Support for eidos.config.json

**candidate_id:** eidos-004  
**title:** Add Versioned Config Migration for eidos.config.json  
**category:** reliability / config  
**linked_issue:** inferred — no config versioning, can't migrate old configs  
**problem:** `eidos.config.json` has no version field. When config schema changes in future releases, users with old configs won't benefit from new defaults or options. No upgrade path.  
**proposed_solution:** Add `version` field to config (default to 1). Add `migrateConfig()` function that applies incremental migrations. Emit warning when config is outdated.  
**target_files:**
- `src/mcp/server.ts` — add migration logic to `loadAutoConfig()`
- `src/mcp/tools/assemble_context.ts` — same
- Or extract to `src/engine/config_migrate.ts`

**test_plan:**
1. Test config with old version gets migrated
2. Test latest version config skips migration
3. Test invalid version field handled gracefully

**risk_level:** Medium — adds config schema changes  
**expected_diff_size:** ~100-150 lines  
**merge_likelihood:** Medium — requires careful version handling  
**maintainer_discussion_needed:** Yes — what version should current configs be?

---

### CANDIDATE 5: Add Cache Hit Rate Metrics

**candidate_id:** eidos-005  
**title:** Add Engine Metrics: Cache Hit Rate and Recall Precision  
**category:** observability / telemetry  
**linked_issue:** inferred — telemetry exists but key engine metrics not tracked  
**problem:** `src/engine/telemetry.ts` has opt-in telemetry, but doesn't track key metrics like: vector search cache hit rate, context assembly precision, budget estimation accuracy, stale item percentage.  
**proposed_solution:** Add `recordMetric(name, value)` to telemetry. Track: `vec_cache_hits`, `vec_cache_misses`, `assemble_precision`, `stale_item_pct`, `budget_override_count`. Expose via `eidos stats --verbose` or new `eidos telemetry metrics` command.  
**target_files:**
- `src/engine/telemetry.ts` — add metric recording
- `src/mcp/tools/assemble_context.ts` — record precision metric
- `src/store/vector.ts` — record cache hits/misses
- `src/cli/stats.ts` — show new metrics

**test_plan:**
1. Verify metrics recorded during normal usage
2. Verify `eidos stats --verbose` shows new metrics
3. Verify no privacy issues (all metrics local)

**risk_level:** Low  
**expected_diff_size:** ~150-200 lines  
**merge_likelihood:** High — additive, telemetry is already present  
**maintainer_discussion_needed:** No

---

### CANDIDATE 6: Add JSON.parse Error Recovery in Node Parsing

**candidate_id:** eidos-006  
**title:** Add Try-Catch Recovery for Node Property JSON Parsing  
**category:** reliability / data-integrity  
**linked_issue:** inferred — `JSON.parse(row.properties)` in nodes.ts and search_memory.ts throws on corrupt data  
**problem:** If node properties contain invalid JSON (data corruption or downgrade), `rowToNode()` and map functions throw unhandled exceptions. Could crash MCP tool or search.  
**proposed_solution:** Wrap JSON.parse in try-catch, return empty object `{}` on parse failure, log warning with node ID. This matches the pattern used elsewhere in the codebase.  
**target_files:**
- `src/store/nodes.ts` — `rowToNode()` function
- `src/mcp/tools/search_memory.ts` — line 32 in timeline mode
- `src/mcp/tools/assemble_context.ts` — line 210

**test_plan:**
1. Create test with corrupt node property — should return empty props, not throw
2. Verify warning logged when this occurs
3. Existing tests still pass

**risk_level:** Low  
**expected_diff_size:** ~30-50 lines  
**merge_likelihood:** High — small safety fix  
**maintainer_discussion_needed:** No

---

### CANDIDATE 7: Add MCP Tool Input Validation Schema

**candidate_id:** eidos-007  
**title:** Add Runtime Validation for MCP Tool Parameters  
**category:** security / reliability  
**linked_issue:** inferred — MCP tools cast params directly without validation  
**problem:** All `handle*` functions in MCP tools do direct type casts (`String()`, `Number()`) on params without validating presence, type, or range. Malformed requests produce confusing errors.  
**proposed_solution:** Create `validateParams(params, schema)` utility with required fields, types, and defaults. Add validation at the top of each tool handler. Return clear error messages for missing/invalid params.  
**target_files:**
- `src/mcp/tools/validate_params.ts` (new)
- `src/mcp/tools/search_memory.ts`
- `src/mcp/tools/assemble_context.ts`
- `src/mcp/tools/remember.ts`
- `src/mcp/tools/index_project.ts`

**test_plan:**
1. Test missing required params returns clear error
2. Test wrong type param returns clear error
3. Test valid params still work

**risk_level:** Low  
**expected_diff_size:** ~100-150 lines  
**merge_likelihood:** Medium — changes error message format  
**maintainer_discussion_needed:** Yes — what error format does maintainer prefer?

---

### CANDIDATE 8: Add Stale Index Background Refresh

**candidate_id:** eidos-008  
**title:** Add Async Background Re-indexing When Stale Items Detected  
**category:** reliability / UX  
**linked_issue:** inferred — `assemble_context.ts` detects stale items but only prints warning  
**problem:** When `result.staleCount > 0`, the system warns the user to run `eidos index .` manually. But for long-running sessions, the index becomes increasingly stale. No automatic refresh mechanism.  
**proposed_solution:** Add an optional background refresh flag `auto_refresh_index` in config. When enabled and stale items detected, trigger async re-indexing of changed files in background. Show count of refreshed items.  
**target_files:**
- `src/mcp/tools/assemble_context.ts` — detect stale, trigger refresh
- `src/mcp/tools/index_project.ts` — add incremental index mode
- `src/store/nodes.ts` — track file hashes for change detection

**test_plan:**
1. Test stale detection fires correctly
2. Test background refresh doesn't block main request
3. Test user can disable via config

**risk_level:** High — background indexing is complex, could cause performance issues  
**expected_diff_size:** ~300-400 lines  
**merge_likelihood:** Low — high complexity, may not be wanted  
**maintainer_discussion_needed:** Yes — is this a desired feature?

---

### CANDIDATE 9: Add Session Cache Memory Monitoring

**candidate_id:** eidos-009  
**title:** Add Memory Monitoring for Session Caches  
**category:** reliability / memory-management  
**linked_issue:** inferred — `_sessionLastNodes` Map grows until 1000 then evicts, but no monitoring  
**problem:** The session caches (`_sessionLastNodes`, `_sessionFirstCall`, `_sessionLastAssemble`) in `assemble_context.ts` evict when > 1000 entries, but there's no way to know how full they are. Long-running MCP servers with many sessions may accumulate memory.  
**proposed_solution:** Add `getCacheStats()` function returning `{ size, maxSize, evictionCount }`. Expose via MCP tool or `eidos stats` so operators can monitor cache health. Add metrics for session count and average cache size.  
**target_files:**
- `src/mcp/tools/assemble_context.ts` — add stats export
- `src/cli/stats.ts` — display cache stats

**test_plan:**
1. Test cache stats reflect actual cache state
2. Test eviction counter increments correctly
3. Test `eidos stats` shows cache info

**risk_level:** Low  
**expected_diff_size:** ~80-100 lines  
**merge_likelihood:** High — simple addition  
**maintainer_discussion_needed:** No

---

### CANDIDATE 10: Add BGE Base Model Support

**candidate_id:** eidos-010  
**title:** Add bge-base-en-v1.5 as Optional Higher-Quality Embedding Model  
**category:** feature / embedding  
**linked_issue:** inferred — codebase already references bge-base in SUPPORTED_MODELS but not exposed  
**problem:** `src/engine/embedding.ts` line 25-28 already defines `bge-base` model with 768-dim embeddings and ~90MB size, but there's no way for users to select it via env var or config. This is a higher-quality model for code search.  
**proposed_solution:** Document `EIDOS_EMBEDDING_MODEL=bge-base` in docs/configuration.md. Add model validation to ensure dimension mismatch with existing vectors is handled (or warn). Add `eidos download-model --model bge-base` to pre-download.  
**target_files:**
- `docs/configuration.md` — document EIDOS_EMBEDDING_MODEL
- `src/engine/embedding.ts` — already supports, just needs docs
- `src/cli/index.ts` — add model selection to `download-model` command

**test_plan:**
1. Test EIDOS_EMBEDDING_MODEL=bge-base loads correctly
2. Test dimension validation when mixing models
3. Test pre-download works for bge-base

**risk_level:** Medium — dimension mismatch if user switches existing DB  
**expected_diff_size:** ~100-120 lines (mostly docs)  
**merge_likelihood:** High — already implemented, just needs documentation  
**maintainer_discussion_needed:** Yes — should there be a warning when switching models with existing DB?

---

### CANDIDATE 11: Add E2E Test for Session Resume

**candidate_id:** eidos-011  
**title:** Add Comprehensive End-to-End Test for Session Resume Flow  
**category:** testing / reliability  
**linked_issue:** inferred — existing e2e.test.ts has basic session resume but no cross-session memory verification  
**problem:** The e2e test only covers basic session resume. Doesn't test that decisions made in session A are remembered in session B, that QMS generation works, that observation summarization works across sessions.  
**proposed_solution:** Expand `test/e2e.test.ts` with multi-session tests: (1) create decision in session 1, verify searchable in session 2; (2) verify QMS is auto-generated and loaded; (3) verify observation summarization after session end.  
**target_files:**
- `test/e2e.test.ts`

**test_plan:**
1. Run full e2e session resume test
2. Verify cross-session memory works
3. Verify QMS export/import cycle

**risk_level:** Low  
**expected_diff_size:** ~100-150 lines  
**merge_likelihood:** High — test-only change  
**maintainer_discussion_needed:** No

---

### CANDIDATE 12: Add README Badges for Popular Package Manager Support

**candidate_id:** eidos-012  
**title:** Add pnpm/yarn Installation Badge to README  
**category:** documentation / discoverability  
**linked_issue:** None — documentation improvement  
**problem:** README only shows npm install command. pnpm and yarn users may not realize the package works with their package manager. Adding alternative install badges improves discoverability.  
**proposed_solution:** Add pnpm and yarn install commands to quick-start section. Add small badges showing package manager compatibility.  
**target_files:**
- `README.md`

**test_plan:**
1. Verify README renders correctly with new badges
2. Check all links still work

**risk_level:** None  
**expected_diff_size:** ~20-30 lines  
**merge_likelihood:** High — trivial docs change  
**maintainer_discussion_needed:** No

---

## Summary Table

| ID | Title | Category | Risk | Diff Size | Merge Likelihood | Discussion Needed |
|----|-------|----------|------|-----------|------------------|-------------------|
| eidos-001 | Config Schema Validation | reliability | Low | ~200 | High | Yes |
| eidos-002 | Structured Logging | observability | Low | ~300 | High | No |
| eidos-003 | Vector Search Failure Warning | reliability | Low | ~80 | High | No |
| eidos-004 | Config Migration | reliability | Medium | ~150 | Medium | Yes |
| eidos-005 | Cache Metrics | observability | Low | ~200 | High | No |
| eidos-006 | JSON.parse Error Recovery | reliability | Low | ~50 | High | No |
| eidos-007 | MCP Tool Input Validation | security | Low | ~150 | Medium | Yes |
| eidos-008 | Stale Index Background Refresh | reliability | High | ~400 | Low | Yes |
| eidos-009 | Session Cache Monitoring | reliability | Low | ~100 | High | No |
| eidos-010 | BGE Base Model Support | feature | Medium | ~120 | High | Yes |
| eidos-011 | E2E Session Resume Tests | testing | Low | ~150 | High | No |
| eidos-012 | README Package Manager Badges | docs | None | ~30 | High | No |