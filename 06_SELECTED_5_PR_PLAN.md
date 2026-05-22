# Phase 6 — Selected 5 PR Plan: eidos-memory

## Selection Criteria

Chosen based on: risk_level, expected_diff_size, merge_likelihood, maintainer_discussion_needed, and overall impact to codebase quality and user experience.

**Selected 5 (in priority order):**

---

## Selected PR 1: CANDIDATE eidos-003 — Vector Search Failure Warning

**Rationale:** Highest impact per lines changed. Users currently don't know when vector search fails — they just get degraded results silently. This is a small fix (~80 lines) with no breaking changes and clear user benefit.

| Field | Value |
|-------|-------|
| candidate_id | eidos-003 |
| title | Warn Users When Vector Search Fails to Initialize |
| target_files | `src/store/vector.ts`, `src/store/db.ts` |
| expected_diff_size | ~50-80 lines |
| risk_level | Low |
| merge_likelihood | High |
| maintainer_discussion_needed | No |

**Implementation approach:**
1. Add `_vssWarningLogged` flag in `vector.ts`
2. On first `insertVec`/`searchVec` failure, emit one-time warning via `console.error`
3. In `getDb()`, log which backend is active (vec/vss/none) on initialization
4. Tests: verify warning appears when VSS fails, doesn't appear when it succeeds

---

## Selected PR 2: CANDIDATE eidos-001 — Config Schema Validation

**Rationale:** Config validation is a foundational improvement. Silent config failures affect all users. ~200 lines with clear spec. Has some maintainer discussion needed but decision is straightforward (warn vs silently ignore).

| Field | Value |
|-------|-------|
| candidate_id | eidos-001 |
| title | Add JSON Schema Validation for eidos.config.json |
| target_files | `src/mcp/server.ts`, `src/mcp/tools/assemble_context.ts`, `src/engine/config_schema.ts` (new) |
| expected_diff_size | ~150-200 lines |
| risk_level | Low |
| merge_likelihood | High |
| maintainer_discussion_needed | Yes |

**Maintainer question:** Should invalid config (a) warn and use defaults, or (b) throw error and exit? Current behavior is (a). Proposed change: keep (a) but warn clearly.

**Implementation approach:**
1. Create `src/engine/config_schema.ts` with `validateConfig(config: object): ValidationResult`
2. Check required fields: `token_budget` (positive integer), `adaptive_budget` (boolean)
3. Warn via `console.warn` when config is ignored
4. Use defaults for missing/invalid fields
5. Add tests for malformed configs

---

## Selected PR 3: CANDIDATE eidos-006 — JSON.parse Error Recovery

**Rationale:** Data corruption resilience — small change (~50 lines) that prevents crashes on malformed node data. Follows existing codebase patterns (try-catch with fallback). High value for production stability.

| Field | Value |
|-------|-------|
| candidate_id | eidos-006 |
| title | Add Try-Catch Recovery for Node Property JSON Parsing |
| target_files | `src/store/nodes.ts`, `src/mcp/tools/search_memory.ts`, `src/mcp/tools/assemble_context.ts` |
| expected_diff_size | ~30-50 lines |
| risk_level | Low |
| merge_likelihood | High |
| maintainer_discussion_needed | No |

**Implementation approach:**
1. In `rowToNode()` (nodes.ts line 26-37), wrap `JSON.parse` in try-catch
2. On parse failure, return `{}` as properties and log warning with node ID
3. Apply same pattern to `search_memory.ts` line 32 and `assemble_context.ts` line 210
4. Add test: create node with invalid JSON properties, verify graceful recovery

---

## Selected PR 4: CANDIDATE eidos-005 — Cache Metrics

**Rationale:** Observability improvement — telemetry already exists, adding metrics is additive and low risk. ~200 lines. Gives maintainers visibility into cache health without changing behavior.

| Field | Value |
|-------|-------|
| candidate_id | eidos-005 |
| title | Add Engine Metrics: Cache Hit Rate and Recall Precision |
| target_files | `src/engine/telemetry.ts`, `src/mcp/tools/assemble_context.ts`, `src/store/vector.ts`, `src/cli/stats.ts` |
| expected_diff_size | ~150-200 lines |
| risk_level | Low |
| merge_likelihood | High |
| maintainer_discussion_needed | No |

**Implementation approach:**
1. Add `recordMetric(name: string, value: number)` to telemetry
2. In `vector.ts`, track `vec_cache_hits` / `vec_cache_misses` on search
3. In `assemble_context.ts`, track `assemble_precision` and `stale_item_pct`
4. Add `eidos stats --verbose` or new `eidos telemetry metrics` command
5. All metrics local-only (no network transmission)

---

## Selected PR 5: CANDIDATE eidos-011 — E2E Session Resume Tests

**Rationale:** Testing improvement — the codebase has 106 tests but e2e coverage for the core session resume feature is minimal. Test-only change ~150 lines, no production risk, improves confidence in the core workflow.

| Field | Value |
|-------|-------|
| candidate_id | eidos-011 |
| title | Add Comprehensive End-to-End Test for Session Resume Flow |
| target_files | `test/e2e.test.ts` |
| expected_diff_size | ~100-150 lines |
| risk_level | Low |
| merge_likelihood | High |
| maintainer_discussion_needed | No |

**Implementation approach:**
1. Add test: create decision in session 1, verify searchable in session 2
2. Add test: verify QMS auto-generated on session end
3. Add test: verify QMS loaded on session start
4. Add test: verify cross-session observations visible
5. Use isolated workspace per test to avoid state leakage

---

## Merge Order

1. **eidos-006** (JSON error recovery) — safest, smallest, test-only touches existing logic slightly
2. **eidos-003** (vector failure warning) — small, observable improvement
3. **eidos-001** (config validation) — foundational, may influence other changes
4. **eidos-005** (cache metrics) — additive telemetry
5. **eidos-011** (e2e tests) — test-only, no production impact

## Rejected Candidates & Rationale

| Candidate | Reason for Rejection |
|-----------|---------------------|
| eidos-002 (Structured Logging) | High diff size (~300 lines) — deferred to a later sprint |
| eidos-004 (Config Migration) | Medium risk, needs careful version handling — complex for v0.2 |
| eidos-007 (MCP Input Validation) | Medium merge likelihood — maintainer discussion on error format needed |
| eidos-008 (Stale Index Refresh) | High risk/complexity — not appropriate for current phase |
| eidos-009 (Session Cache Monitoring) | Lower impact than selected 5 — defer |
| eidos-010 (BGE Base Model) | Medium risk — DB dimension mismatch concern needs warning design |
| eidos-012 (README badges) | Lowest priority — trivial change, not blocking anything |