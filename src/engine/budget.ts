import { countTokens } from './tokens.js';
import { classifyIntent, type IntentClass } from './intent.js';

export interface BudgetEstimate {
  budget: number;
  intent: IntentClass;
  confidence: number;
  reason: string;
}

// Budget ranges per intent class (min, default, max)
const INTENT_BUDGET: Record<IntentClass, { min: number; max: number; base: number }> = {
  code_impl:       { min: 1500, base: 2500, max: 4000 },
  debugging:       { min: 1500, base: 3000, max: 4000 },
  decision_recall: { min: 500,  base: 1000, max: 2000 },
  recap:           { min: 800,  base: 1500, max: 2500 },
  explanation:     { min: 800,  base: 1500, max: 3000 },
};

const GLOBAL_MIN = 500;
const GLOBAL_MAX = 4000;

export interface BudgetConfig {
  token_budget: number;
  adaptive_budget: boolean;
  model_cost_per_1k_tokens: number;
}

export async function estimateBudget(
  query: string,
  config: BudgetConfig,
): Promise<BudgetEstimate> {
  // If adaptive is disabled, just use config value
  if (!config.adaptive_budget) {
    return {
      budget: config.token_budget,
      intent: 'explanation',
      confidence: 1.0,
      reason: 'adaptive budget disabled — using config value',
    };
  }

  // Step 1: query complexity from token count
  const queryTokens = countTokens(query);
  const complexityFactor = Math.min(1.0, queryTokens / 50); // 0→1 over 0–50 tokens

  // Step 2: intent classification
  const intentResult = await classifyIntent(query);
  const { intent, confidence } = intentResult;
  const range = INTENT_BUDGET[intent];

  // Step 3: blend base budget with complexity + query length
  // high complexity → push toward max; low confidence → shrink toward min
  // also add a direct token-length bonus so long queries always get more budget
  const tokenBonus = Math.round(queryTokens * 8); // 8 tokens budget per query token
  const blended = Math.round(
    range.min
    + (range.base - range.min) * confidence
    + (range.max - range.base) * complexityFactor * confidence
    + tokenBonus,
  );

  const budget = Math.max(GLOBAL_MIN, Math.min(GLOBAL_MAX, blended));

  const reason =
    `intent=${intent}(${(confidence * 100).toFixed(0)}%) ` +
    `queryTokens=${queryTokens} → budget=${budget}`;

  return { budget, intent, confidence, reason };
}
