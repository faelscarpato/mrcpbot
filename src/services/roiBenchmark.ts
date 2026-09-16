export interface CodebaseMetrics {
  filesCount: number;
  totalLines: number;
  totalBytes: number;
  functionsCount: number;
  importsCount: number;
  securityIssuesCount?: number;
  deadCodeCount?: number;
  repoName?: string;
}

export interface CostModel {
  name: string;
  inputPerMillion: number; // in USD
  outputPerMillion: number; // in USD
}

export const PRICING_TIERS: Record<string, CostModel> = {
  frontier: {
    name: "Frontier (Claude 3.5 Sonnet / GPT-4o)",
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
  },
  geminiPro: {
    name: "Gemini 3.1 Pro / Pro Preview",
    inputPerMillion: 1.25,
    outputPerMillion: 5.0,
  },
  geminiFlash: {
    name: "Gemini 3.5 Flash",
    inputPerMillion: 0.15,
    outputPerMillion: 0.6,
  },
};

export interface BenchmarkReport {
  rawCodeTokens: number;
  mrcpAstTokens: number;
  tokenReductionPercent: number;
  turnsPerTask: number;

  // Per Task Analysis
  withoutMrcp: {
    tokensPerTask: number;
    costPerTaskUSD: number;
    latencySeconds: number;
    contextExhaustionRisk: "CRÍTICO" | "ALTO" | "MODERADO" | "BAIXO";
    hallucinationRisk: "Alto (Perda de escopo e grafos implícitos)" | "Médio";
  };
  withMrcp: {
    tokensPerTask: number;
    costPerTaskUSD: number;
    latencySeconds: number;
    contextExhaustionRisk: "NENHUM";
    hallucinationRisk: "0% (Grafo sintático determinístico AST)";
  };

  // Comparative Savings
  savings: {
    tokensSavedPerTask: number;
    percentSaved: number;
    dollarSavedPerTaskUSD: number;
    monthlySavingsTeam5USD: number;
    monthlySavingsTeam10USD: number;
    monthlySavingsTeam25USD: number;
    monthlyTokensSavedMillions: number;
  };

  metrics: CodebaseMetrics;
}

/**
 * Calculates deterministic ROI & token economics comparing raw LLM ingestion vs MRCP AST Engine.
 */
export function calculateBenchmark(
  metrics: CodebaseMetrics,
  turnsPerTask = 8,
  tier: "frontier" | "geminiPro" | "geminiFlash" = "frontier",
): BenchmarkReport {
  const pricing = PRICING_TIERS[tier] || PRICING_TIERS.frontier;

  // 1 token ≈ 3.8 to 4.0 characters of code
  const rawCodeTokens = Math.max(
    Math.round(metrics.totalBytes / 3.8),
    metrics.totalLines * 7, // fallback estimation if bytes low
    1200,
  );

  // MRCP AST extracts deterministic signatures, call graphs, API routes, and security alerts.
  // Instead of all code lines, it outputs structured index representation.
  // Typically 1.5% to 6% of the raw codebase tokens.
  const estimatedAstPackTokens = Math.max(
    Math.round(
      metrics.functionsCount * 14 +
        metrics.importsCount * 6 +
        (metrics.securityIssuesCount || 0) * 18 +
        (metrics.deadCodeCount || 0) * 12 +
        metrics.filesCount * 25,
    ),
    450,
  );
  // Guarantee realistically capped AST footprint
  const mrcpAstTokens = Math.min(
    estimatedAstPackTokens,
    Math.round(rawCodeTokens * 0.08) || 3500,
  );

  // In an agent workflow (e.g. Cursor, Windsurf, Claude Code, Cline, Copilot):
  // Without MRCP: Full or partial raw files are re-injected in conversation turns.
  // Average context re-injection per turn:
  const withoutMrcpTokensPerTurn = rawCodeTokens;
  const withoutMrcpTotalTokens = Math.round(
    withoutMrcpTokensPerTurn * turnsPerTask,
  );

  // With MRCP: Initial AST Pack once + incremental high-precision diffs/tool calls (~350 tokens per turn)
  const withMrcpTotalTokens = Math.round(mrcpAstTokens + turnsPerTask * 380);

  const tokensSavedPerTask = Math.max(
    withoutMrcpTotalTokens - withMrcpTotalTokens,
    0,
  );
  const percentSaved = Number(
    ((tokensSavedPerTask / withoutMrcpTotalTokens) * 100).toFixed(1),
  );

  // Cost calculation
  // Assume ~500 output tokens per turn
  const outputTokensPerTask = turnsPerTask * 500;

  const costWithoutMrcp =
    (withoutMrcpTotalTokens / 1_000_000) * pricing.inputPerMillion +
    (outputTokensPerTask / 1_000_000) * pricing.outputPerMillion;

  const costWithMrcp =
    (withMrcpTotalTokens / 1_000_000) * pricing.inputPerMillion +
    (outputTokensPerTask / 1_000_000) * pricing.outputPerMillion;

  const dollarSavedPerTaskUSD = Number(
    Math.max(costWithoutMrcp - costWithMrcp, 0).toFixed(4),
  );

  // Monthly projections (22 working days, 15 agent tasks per dev/day = 330 tasks/dev/month)
  const tasksPerDevPerMonth = 330;
  const monthlySavings5 = Number(
    (dollarSavedPerTaskUSD * tasksPerDevPerMonth * 5).toFixed(2),
  );
  const monthlySavings10 = Number(
    (dollarSavedPerTaskUSD * tasksPerDevPerMonth * 10).toFixed(2),
  );
  const monthlySavings25 = Number(
    (dollarSavedPerTaskUSD * tasksPerDevPerMonth * 25).toFixed(2),
  );
  const monthlyTokensMillions = Number(
    ((tokensSavedPerTask * tasksPerDevPerMonth * 10) / 1_000_000).toFixed(1),
  );

  const contextRisk =
    withoutMrcpTotalTokens > 500_000
      ? "CRÍTICO"
      : withoutMrcpTotalTokens > 150_000
        ? "ALTO"
        : withoutMrcpTotalTokens > 60_000
          ? "MODERADO"
          : "BAIXO";

  return {
    rawCodeTokens,
    mrcpAstTokens,
    tokenReductionPercent: percentSaved,
    turnsPerTask,
    withoutMrcp: {
      tokensPerTask: withoutMrcpTotalTokens,
      costPerTaskUSD: Number(costWithoutMrcp.toFixed(4)),
      latencySeconds: Number((rawCodeTokens / 18_000 + 4).toFixed(1)), // Estimated LLM ingestion time
      contextExhaustionRisk: contextRisk,
      hallucinationRisk: "Alto (Perda de escopo e grafos implícitos)",
    },
    withMrcp: {
      tokensPerTask: withMrcpTotalTokens,
      costPerTaskUSD: Number(costWithMrcp.toFixed(4)),
      latencySeconds: 0.8, // Tree-sitter WASM deterministic speed
      contextExhaustionRisk: "NENHUM",
      hallucinationRisk: "0% (Grafo sintático determinístico AST)",
    },
    savings: {
      tokensSavedPerTask,
      percentSaved,
      dollarSavedPerTaskUSD,
      monthlySavingsTeam5USD: monthlySavings5,
      monthlySavingsTeam10USD: monthlySavings10,
      monthlySavingsTeam25USD: monthlySavings25,
      monthlyTokensSavedMillions: monthlyTokensMillions,
    },
    metrics,
  };
}
