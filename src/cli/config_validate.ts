import fs from 'fs';

const YELLOW = '\x1b[33m';
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';

interface ConfigSchema {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'string[]';
  deprecated?: string;
  required?: boolean;
}

const SCHEMA: ConfigSchema[] = [
  { key: 'workspace',                  type: 'string'   },
  { key: 'model_cost_per_1k_tokens',   type: 'number'   },
  { key: 'token_budget',               type: 'number',  required: true },
  { key: 'adaptive_budget',            type: 'boolean', required: true },
  { key: 'auto_index',                 type: 'boolean'  },
  { key: 'auto_index_on_git_commit',   type: 'boolean'  },
  { key: 'auto_mode',                  type: 'boolean'  },
  { key: 'auto_index_on_connect',      type: 'boolean'  },
  { key: 'auto_qms_on_session_end',    type: 'boolean'  },
  { key: 'auto_assemble_on_prompt',    type: 'boolean'  },
  { key: 'auto_log_conversations',     type: 'boolean'  },
  { key: 'adapters',                   type: 'string[]' },
  { key: 'mcp_port',                   type: 'number'   },
  { key: 'proxy_port',                 type: 'number'   },
  { key: 'dashboard_port',             type: 'number'   },
  { key: 'summariser',                 type: 'string'   },
  { key: 'decay_lambda',               type: 'number'   },
  { key: 'feedback_lr',                type: 'number'   },
  { key: 'privacy_firewall',           type: 'boolean'  },
  { key: 'skeleton_confidence_threshold', type: 'number' },
  { key: 'federated_workspaces',       type: 'string[]' },
  { key: 'telemetry',                  type: 'boolean'  },
  // Deprecated keys and their replacements
  { key: 'token_limit',                type: 'number',  deprecated: 'token_budget' },
  { key: 'cost_per_token',             type: 'number',  deprecated: 'model_cost_per_1k_tokens' },
];

const SCHEMA_KEYS = new Set(SCHEMA.map(s => s.key));

export const DEFAULT_CONFIG = {
  workspace: '.',
  model_cost_per_1k_tokens: 0.015,
  token_budget: 2000,
  adaptive_budget: true,
  auto_index: true,
  auto_index_on_git_commit: true,
  auto_mode: true,
  auto_index_on_connect: true,
  auto_qms_on_session_end: true,
  auto_assemble_on_prompt: true,
  auto_log_conversations: true,
  adapters: ['claude', 'gemini', 'qwen', 'aider'],
  mcp_port: 3742,
  proxy_port: 4141,
  dashboard_port: 7842,
  summariser: 'local',
  decay_lambda: 0.05,
  feedback_lr: 0.01,
  privacy_firewall: true,
  skeleton_confidence_threshold: 0.7,
  federated_workspaces: [],
  telemetry: false,
};

function checkType(val: unknown, expected: ConfigSchema['type']): boolean {
  if (expected === 'string')   return typeof val === 'string';
  if (expected === 'number')   return typeof val === 'number';
  if (expected === 'boolean')  return typeof val === 'boolean';
  if (expected === 'string[]') return Array.isArray(val) && (val as unknown[]).every(v => typeof v === 'string');
  return false;
}

export function validateConfig(cfgPath: string, fix = false): boolean {
  if (!fs.existsSync(cfgPath)) {
    console.log(`${YELLOW}⚠${RESET}  Config not found at ${cfgPath}`);
    if (fix) {
      fs.writeFileSync(cfgPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
      console.log(`${GREEN}✔${RESET}  Created default config at ${cfgPath}`);
    }
    return false;
  }

  let cfg: Record<string, unknown>;
  try {
    cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) as Record<string, unknown>;
  } catch (e) {
    console.log(`${RED}✖${RESET}  Invalid JSON in ${cfgPath}: ${e}`);
    return false;
  }

  let hasErrors = false;
  const migrations: Record<string, unknown> = {};

  // Check for unknown keys
  for (const key of Object.keys(cfg)) {
    if (!SCHEMA_KEYS.has(key)) {
      console.log(`${YELLOW}⚠${RESET}  Unknown key: ${BOLD}${key}${RESET} — not in schema, will be ignored`);
    }
  }

  // Check schema
  for (const field of SCHEMA) {
    const val = cfg[field.key];

    if (field.deprecated && val !== undefined) {
      console.log(`${YELLOW}⚠${RESET}  Deprecated key ${BOLD}${field.key}${RESET} → use ${BOLD}${field.deprecated}${RESET} instead`);
      if (fix && cfg[field.deprecated!] === undefined) {
        migrations[field.deprecated!] = val;
        migrations[field.key] = undefined;
      }
    }

    if (field.required && val === undefined) {
      console.log(`${RED}✖${RESET}  Missing required key: ${BOLD}${field.key}${RESET}`);
      if (fix) migrations[field.key] = (DEFAULT_CONFIG as Record<string, unknown>)[field.key];
      hasErrors = true;
    }

    if (val !== undefined && !checkType(val, field.type)) {
      console.log(`${RED}✖${RESET}  Key ${BOLD}${field.key}${RESET} expected ${field.type}, got ${typeof val}`);
      hasErrors = true;
    }
  }

  if (fix && Object.keys(migrations).length > 0) {
    const updated = { ...cfg };
    for (const [k, v] of Object.entries(migrations)) {
      if (v === undefined) delete updated[k];
      else updated[k] = v;
    }
    fs.writeFileSync(cfgPath, JSON.stringify(updated, null, 2));
    console.log(`${GREEN}✔${RESET}  Config migrated and saved to ${cfgPath}`);
  }

  if (!hasErrors) {
    console.log(`${GREEN}✔${RESET}  ${cfgPath} is valid`);
  }

  return !hasErrors;
}
