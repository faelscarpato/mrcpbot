import fs from "node:fs";
import {
  mutationContract,
  policyVerdict,
  fileEvidence,
  normalizePolicy,
  type ProposedChange,
  type GatePolicy,
  type GateResult,
  type PolicyVerdict,
  type FileChange,
} from "./contracts.js";
import { estimateComplexity } from "../analysis/code-health.js";

export const SECRET_PATTERNS = [
  { name: "aws-access-key", regex: /AKIA[0-9A-Z]{16}/ },
  { name: "private-key", regex: /-----BEGIN (?:RSA )?PRIVATE KEY-----/ },
  {
    name: "password-assign",
    regex: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]+['"]/i,
  },
  { name: "github-token", regex: /gh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: "generic-api-key", regex: /api[_-]?key\s*[:=]\s*['"][^'"]{8,}['"]/i },
  { name: "supabase-secret", regex: /sb_secret_[A-Za-z0-9_-]{20,}/ },
];

/**
 * Scans content for secrets and returns pattern NAMES only.
 * NEVER returns the matched value to ensure zero secret leakage.
 */
export function scanSecrets(content: string = ""): string[] {
  const found: string[] = [];
  for (const p of SECRET_PATTERNS) {
    if (p.regex.test(content)) {
      found.push(p.name);
    }
  }
  return found;
}

/**
 * Checks if a file has an associated test either declared, in change files, or named as a test.
 */
function checkFileHasTests(file: FileChange, allFiles: FileChange[]): boolean {
  if (file.hasTests !== undefined) {
    return file.hasTests;
  }

  const p = file.path.toLowerCase();
  if (
    p.includes(".test.") ||
    p.includes(".spec.") ||
    p.includes("/test/") ||
    p.includes("/tests/") ||
    p.includes("__tests__")
  ) {
    return true;
  }

  // Check if allFiles contains a corresponding test file
  const baseName = file.path.replace(/\.[^.]+$/, "");
  const hasSiblingTest = allFiles.some((f) => {
    const siblingPath = f.path.toLowerCase();
    return (
      siblingPath.includes(baseName.toLowerCase()) &&
      (siblingPath.includes(".test.") || siblingPath.includes(".spec."))
    );
  });

  if (hasSiblingTest) return true;

  // Check if test exists on local filesystem
  try {
    const extensions = [
      ".test.ts",
      ".spec.ts",
      ".test.js",
      ".spec.js",
      ".test.tsx",
      ".spec.tsx",
    ];
    for (const ext of extensions) {
      if (fs.existsSync(baseName + ext)) {
        return true;
      }
    }
  } catch {
    // Non-filesystem context: ignore
  }

  return false;
}

export interface EvaluateOptions {
  commit?: string;
  checkRealComplexity?: boolean;
}

/**
 * Evaluates a proposed code mutation against deterministic governance policies.
 * Returns allow/warn/deny verdict with cryptographic provenance and verifiable AST evidence.
 */
export function evaluateMutation(
  change: ProposedChange,
  policyInput: Partial<GatePolicy> = {},
  opts: EvaluateOptions = {},
): GateResult {
  if (!change || !Array.isArray(change.files)) {
    throw new Error("CHANGE_INVALID: change.files must be an array");
  }

  const policy = normalizePolicy(policyInput);
  const commit = change.commit ?? opts.commit ?? "local";
  const verdicts: PolicyVerdict[] = [];

  // 1. Rule: max_files
  if (change.files.length > policy.maxFiles) {
    verdicts.push(
      policyVerdict({
        rule: "max_files",
        severity: "error",
        decision: "deny",
        evidence: change.files.map((f) => fileEvidence(f, commit)),
        expiresAt: policy.expiresAt,
      }),
    );
  }

  // 2. Rule: forbidden_path
  for (const f of change.files) {
    if (policy._forbidden?.some((re) => re.test(f.path))) {
      verdicts.push(
        policyVerdict({
          rule: "forbidden_path",
          severity: "error",
          decision: "deny",
          evidence: [fileEvidence(f, commit)],
          expiresAt: policy.expiresAt,
        }),
      );
    }
  }

  // 3. Rule: secret_leak (names only — never values)
  for (const f of change.files) {
    const hits = scanSecrets(f.content ?? "");
    if (hits.length > 0) {
      verdicts.push(
        policyVerdict({
          rule: "secret_leak",
          severity: "error",
          decision: "deny",
          evidence: [{ ...fileEvidence(f, commit), patterns: hits }],
          expiresAt: policy.expiresAt,
        }),
      );
    }
  }

  // 4. Rule: complexity_budget (AST-driven or pre-calculated)
  let totalDelta = 0;
  for (const f of change.files) {
    if (f.complexityDelta !== undefined) {
      totalDelta += f.complexityDelta;
    } else if (f.content && opts.checkRealComplexity) {
      totalDelta += estimateComplexity(f.content);
    }
  }

  if (totalDelta > policy.maxComplexityDelta) {
    verdicts.push(
      policyVerdict({
        rule: "complexity_budget",
        severity: "error",
        decision: "deny",
        evidence: [{ totalDelta, max: policy.maxComplexityDelta, commit }],
        expiresAt: policy.expiresAt,
      }),
    );
  } else if (totalDelta > policy.warnComplexityDelta) {
    verdicts.push(
      policyVerdict({
        rule: "complexity_budget",
        severity: "warning",
        decision: "warn",
        evidence: [
          { totalDelta, warnOver: policy.warnComplexityDelta, commit },
        ],
        expiresAt: policy.expiresAt,
      }),
    );
  }

  // 5. Rule: test_coverage_gate (missing_tests)
  for (const f of change.files) {
    const needsTests = policy.requiredTestsFor.some((prefix) =>
      f.path.startsWith(prefix),
    );
    const hasTests = checkFileHasTests(f, change.files);
    if (needsTests && !hasTests) {
      verdicts.push(
        policyVerdict({
          rule: "missing_tests",
          severity: "warning",
          decision: "warn",
          evidence: [fileEvidence(f, commit)],
          expiresAt: policy.expiresAt,
        }),
      );
    }
  }

  const decision = verdicts.some((v) => v.decision === "deny")
    ? "deny"
    : verdicts.some((v) => v.decision === "warn")
      ? "warn"
      : "allow";

  const contract = mutationContract({
    targets: change.files.map((f) => f.path),
    forbidden: [...policy.forbiddenPaths],
    requiredTests: [...policy.requiredTestsFor],
    maxFiles: policy.maxFiles,
    maxComplexityDelta: policy.maxComplexityDelta,
    rollbackPlan: `git stash / git revert ${commit}`,
  });

  return {
    version: "v1",
    code:
      decision === "allow"
        ? "POLICY_ALLOW"
        : decision === "warn"
          ? "POLICY_WARN"
          : "POLICY_DENIED",
    decision,
    verdicts,
    contract,
    provenance: { repo: change.repo ?? "local", commit },
  };
}

export const evaluate = evaluateMutation;
