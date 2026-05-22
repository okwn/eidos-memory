# Phase 4 — Issue & PR Triage: eidos-memory

## GitHub API Results
| Resource | Open | Closed | Merged |
|----------|------|--------|--------|
| Issues | 0 | 0 | N/A |
| PRs | 0 | 0 | N/A |

**Note:** `gh issue list` and `gh pr list` returned empty results. This could indicate:
1. The repo uses GitHub Issues/Gitea or another tracker
2. API rate limiting (unauthenticated)
3. The repo has no issues/PRs created yet
4. Issues are managed through a different mechanism

## Repository Activity Assessment

Despite zero GitHub Issues/PRs visible via API, the codebase shows active development:
- **106 passing tests** across 10 test files
- **71 TypeScript source files** covering MCP, engine, CLI, store, dashboard, sync
- **14 MCP tools** implemented
- **Version 0.2.0** with CHANGELOG.md tracking releases
- Recent commits active in `.git`

## Inferred Issue Categories (from code analysis)

Since no GitHub issues were found, issues were inferred from code review:

### Category 1: Configuration & Validation
| Area | File | Issue | Severity | Clarity | Reproduction | Overlap | Fix Size |
|------|------|-------|----------|---------|---------------|---------|----------|
| Config validation | `src/mcp/server.ts` | `loadAutoConfig()` silently ignores parse errors, uses all defaults | Low | High | Easy | No overlap | Small |
| Config defaults | `src/mcp/tools/assemble_context.ts` | `loadConfig()` silently ignores errors, hardcodes 2000 budget | Low | High | Easy | No overlap | Small |

### Category 2: Error Handling
| Area | File | Issue | Severity | Clarity | Reproduction | Overlap | Fix Size |
|------|------|-------|----------|---------|---------------|---------|----------|
| Silent failures | `src/store/vector.ts` | `insertVec`, `deleteVec` silently catch errors — vectors not stored but no user feedback | Medium | High | Easy | No overlap | Small |
| Migration errors | `src/store/db.ts` | Migration catches errors with empty `catch {}` blocks | Medium | High | Medium | No overlap | Small |
| Embedding loading | `src/engine/embedding.ts` | Model loading failures print to stderr but don't throw clearly | Medium | Medium | Medium | No overlap | Medium |

### Category 3: Memory Management
| Area | File | Issue | Severity | Clarity | Reproduction | Overlap | Fix Size |
|------|------|-------|----------|---------|---------------|---------|----------|
| Unbounded cache | `src/mcp/tools/assemble_context.ts` | `_sessionLastNodes` Map can grow indefinitely — `evictIfNeeded()` only triggers after 1000 entries | Medium | High | Hard | No overlap | Small |
| Global singletons | `src/store/db.ts` | `_db`, `_vssLoaded`, `_vecBackend` are module-level singletons — hard to test/reset | Medium | High | Medium | No overlap | Medium |
| Pipeline singleton | `src/engine/embedding.ts` | `_pipeline` singleton with `_loading` flag but no reset mechanism | Low | High | Hard | No overlap | Medium |

### Category 4: Observability
| Area | File | Issue | Severity | Clarity | Reproduction | Overlap | Fix Size |
|------|------|-------|----------|---------|---------------|---------|----------|
| No structured logs | Multiple | Uses `console.error` for all logging — no log levels / structured logging | Low | High | Easy | No overlap | Medium |
| Missing metrics | `src/engine/telemetry.ts` | Telemetry exists but key engine metrics (cache hit rate, recall precision) not tracked | Low | Medium | Medium | No overlap | Medium |

### Category 5: Edge Cases
| Area | File | Issue | Severity | Clarity | Reproduction | Overlap | Fix Size |
|------|------|-------|----------|---------|---------------|---------|----------|
| Empty query | `src/mcp/tools/search_memory.ts` | `handleSearchMemory` with empty query defaults to `''` — could return unexpected results | Low | High | Easy | No overlap | Small |
| Stale index | `assemble_context.ts` | Detects stale items but only prints warning, no background refresh | Medium | Medium | Medium | No overlap | Large |
| Vec rowid conflict | `src/store/vector.ts` | `getOrCreateRowid` doesn't handle race conditions in concurrent inserts | Medium | Medium | Hard | No overlap | Medium |

### Category 6: Security & Privacy
| Area | File | Issue | Severity | Clarity | Reproduction | Overlap | Fix Size |
|------|------|-------|----------|---------|---------------|---------|----------|
| No input sanitization | MCP tools | `handle*` functions cast params directly with `String()` / `Number()` — no validation | Medium | High | Easy | No overlap | Medium |
| Config injection | `src/mcp/server.ts` | `loadAutoConfig` reads JSON from `eidos.config.json` — no schema validation | Medium | High | Easy | No overlap | Medium |

## PR/Issue Summary

Given zero visible GitHub issues, the repository may rely on:
- Internal development tracking
- Issues disabled or managed externally
- Active development without public issue tracking

**Recommendation:** Before opening GitHub issues, check if the maintainer uses a different issue tracker mentioned in README or CONTRIBUTING.md.