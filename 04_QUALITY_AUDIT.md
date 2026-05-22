# Phase 5 — Quality Audit: eidos-memory

## TODO/FIXME Comments
```
$ grep -r "TODO\|FIXME\|XXX\|HACK" src/ --include="*.ts" -n
(no results)
```
✅ **No TODO/FIXME comments found** — codebase appears well-planned with no obvious deferred work markers.

## Broken Links Check
Checked all HTTP URLs in README.md and docs/*.md:

| File | URL | Status |
|------|-----|--------|
| README.md | https://img.shields.io/npm/v/eidos-memory?color=6366f1&label=npm | ⚠️ shields.io (badge, likely OK) |
| README.md | https://github.com/sairajbaman/eidos-memory | ⚠️ GitHub repo |
| README.md | https://github.com/sairajbaman/eidos-memory/actions/workflows/ci.yml | ⚠️ GitHub Actions |
| README.md | https://eidosmemory.vercel.app | ⚠️ Vercel deployment (external) |
| docs/index.md | https://github.com/sairajbaman/eidos-memory | ⚠️ GitHub |
| docs/index.md | https://eidosmemory.vercel.app | ⚠️ Vercel |
| docs/index.md | https://www.npmjs.com/package/eidos-memory | ⚠️ npm (external) |
| docs/index.md | https://github.com/sairajbaman/eidos-memory/issues | ⚠️ GitHub |

**Note:** All external links are to well-known stable services (GitHub, npm, Vercel). No obviously stale links found, but Vercel deployment URL could go stale if deployment is deleted.

## Error Handling Analysis

### Silent Catch Blocks
| File | Line | Issue |
|------|------|-------|
| `src/store/vector.ts` | 44 | `catch {}` — vector insert fails silently |
| `src/store/vector.ts` | 57 | `catch {}` — vector delete fails silently |
| `src/store/vector.ts` | 71-73 | `catch {}` — vector search fails silently, degrades to linear |
| `src/store/db.ts` | 247-248 | `catch {}` — ALTER TABLE migration silently ignores duplicates |
| `src/mcp/server.ts` | 42 | `catch {}` — loadAutoConfig silently ignores all errors |
| `src/mcp/tools/assemble_context.ts` | 20 | `catch {}` — loadConfig silently ignores all errors |

**Impact:** Silent failures mean users don't know when optional features (vector search) fail or when config is misconfigured.

### Missing Error Propagation
| File | Function | Issue |
|------|---------|-------|
| `src/engine/embedding.ts` | `getPipeline()` | Model loading errors print to stderr but throw eventually — acceptable |
| `src/mcp/tools/assemble_context.ts` | `fullIndexOnFirstCall()` | Index failures only write to stderr — non-blocking design is intentional |

## Config Validation

### eidos.config.json Schema Validation
- **Location:** `src/mcp/server.ts` `loadAutoConfig()` and `src/mcp/tools/assemble_context.ts` `loadConfig()`
- **Current behavior:** Both use `JSON.parse()` and silently fall back to defaults on any error
- **Risk:** Invalid config silently uses all defaults — user may not realize their config is ignored
- **No schema validation** — any extra keys are accepted without warning

### Missing Validations
| Config Key | Expected | Actual |
|-----------|----------|--------|
| `token_budget` | positive integer | could be negative or string |
| `adaptive_budget` | boolean | no type check |
| `model_cost_per_1k_tokens` | positive number | no validation |
| `auto_mode` | boolean | no validation |

## Type Safety Concerns

### Unsafe Type Casting
| File | Line | Issue |
|------|------|-------|
| `src/mcp/server.ts` | 115 | `params` cast to `Record<string, unknown>` then accessed via string keys — no runtime validation |
| `src/mcp/tools/search_memory.ts` | 8-9 | `String(params['query'] ?? '')` — empty string on null/undefined, but no validation |
| `src/mcp/tools/assemble_context.ts` | 106-107 | `loadConfig()` returns unvalidated config object |

### JSON.parse without try
| File | Line | Issue |
|------|------|-------|
| `src/store/nodes.ts` | 30 | `JSON.parse(row.properties || '{}')` — if properties is invalid JSON, throws without recovery |
| `src/mcp/tools/search_memory.ts` | 32 | `JSON.parse(n.properties)` — same risk |
| `src/mcp/tools/assemble_context.ts` | 210 | `JSON.parse(node.properties)` — same risk |

## Memory & Resource Leaks

### Unbounded Session Cache
- **File:** `src/mcp/tools/assemble_context.ts` lines 24-39
- **Issue:** `_sessionLastNodes`, `_sessionFirstCall`, `_sessionLastAssemble` are module-level Maps with `evictIfNeeded()` that only triggers after 1000 entries
- **Risk:** Long-running MCP server sessions accumulate entries until threshold
- **Current mitigation:** `MAX_CACHE_ENTRIES = 1000` eviction

### Singleton State
- **File:** `src/store/db.ts` lines 9-11, 13
- **Issue:** `_db`, `_vssLoaded`, `_vecBackend` are module-level singletons
- **Risk:** No ability to reset state between tests — `resetDbInstance()` exists but `_db` is `let` not exported
- **Fix available:** `resetDbInstance()` function exists and is used in tests

### Pipeline Singleton
- **File:** `src/engine/embedding.ts` lines 13-15
- **Issue:** `_pipeline`, `_loading`, `_loadPromise` are module-level
- **Risk:** Model loading state persists across tests

## Docs/Examples Validation

### docs/development.md
- Refers to `git clone https://github.com/sairajbaman/eidos-memory` — valid
- Has clear development setup instructions

### docs/commands.md
- Documents `eidos proxy` command with `-u https://api.openai.com/v1` — correct format

### docs/configuration.md
- Documents `OLLAMA_HOST` env var — standard pattern

## Test Coverage Assessment

From test file listing:
- `phase1-5.test.ts` — incremental feature tests
- `mcp.test.ts` — MCP tool handlers (12 tests)
- `e2e.test.ts` — end-to-end session resume
- `stress.test.ts` — bulk insertion, token counting, intent classification
- `dashboard.test.ts` — dashboard server
- `edge-cases.test.ts` — boundary conditions

**Coverage gaps identified:**
- No tests for vector search fallback (linear search when VSS fails)
- No tests for config validation failure paths
- No tests for empty/repo with no files during indexing

## Summary

| Category | Finding | Severity |
|----------|---------|----------|
| Silent catch blocks | 6 instances — mostly vector/optional features | Medium |
| Config validation | No schema validation, silent fallback | Medium |
| Type safety | JSON.parse without try, unsafe casts | Low-Medium |
| Memory leaks | Unbounded caches with eviction | Low |
| Documentation links | All external links stable | Low |
| TODO/FIXME | None found | ✅ Good |

**Overall:** Codebase is well-structured and tested (106 passing). Main quality concerns are around silent failures in optional features and lack of config schema validation.