import { createHash } from "node:crypto";

export const CONTRACT_VERSION = "v1";

export const DECISIONS = ["allow", "warn", "deny"] as const;
export type Decision = (typeof DECISIONS)[number];

export const ERROR_CODES = [
  "POLICY_DENIED",
  "POLICY_WARN",
  "POLICY_ALLOW",
  "CONTRACT_EXPIRED",
  "PROVENANCE_MISSING",
  "POLICY_INVALID",
  "CHANGE_INVALID",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export type Severity = "error" | "warning" | "info";

export interface FileChange {
  path: string;
  content?: string;
  added?: number;
  removed?: number;
  complexityDelta?: number;
  hasTests?: boolean;
}

export interface ProposedChange {
  repo?: string;
  commit?: string;
  files: FileChange[];
}

export interface FileEvidence {
  file: string;
  contentHash: string;
  bytes: number;
  commit: string;
  patterns?: string[];
  [key: string]: any;
}

export interface PolicyVerdict {
  version: string;
  rule: string;
  severity: Severity;
  decision: Decision;
  evidence: any[];
  expiresAt?: string | null;
}

export interface MutationContract {
  version: string;
  targets: string[];
  forbidden: string[];
  requiredTests: string[];
  maxFiles: number;
  maxComplexityDelta: number;
  rollbackPlan: string;
}

export interface GatePolicy {
  version: number;
  maxFiles: number;
  maxComplexityDelta: number;
  warnComplexityDelta: number;
  forbiddenPaths: string[];
  requiredTestsFor: string[];
  expiresAt?: string | null;
  _forbidden?: RegExp[];
}

export interface GateResult {
  version: string;
  code: ErrorCode;
  decision: Decision;
  verdicts: PolicyVerdict[];
  contract: MutationContract;
  provenance: {
    repo: string;
    commit: string;
  };
}

export const DEFAULT_POLICY: GatePolicy = {
  version: 1,
  maxFiles: 5,
  maxComplexityDelta: 10,
  warnComplexityDelta: 5,
  forbiddenPaths: ["^\\.env", "\\.pem$", "id_rsa", "id_ed25519", "^secrets/"],
  requiredTestsFor: ["src/", "packages/"],
  expiresAt: null,
};

/**
 * Computes sha256 hex of content string.
 */
export function contentHash(content: string = ""): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Computes deterministic file evidence with content hash, bytes, and commit.
 */
export function fileEvidence(
  file: FileChange,
  commit: string = "local",
): FileEvidence {
  return {
    file: file.path,
    contentHash: contentHash(file.content ?? file.path),
    bytes: (file.content ?? "").length,
    commit,
  };
}

/**
 * Creates a normalized mutation contract object.
 */
export function mutationContract(
  input: Partial<MutationContract> = {},
): MutationContract {
  return {
    version: CONTRACT_VERSION,
    targets: input.targets ?? [],
    forbidden: input.forbidden ?? [],
    requiredTests: input.requiredTests ?? [],
    maxFiles: input.maxFiles ?? 0,
    maxComplexityDelta: input.maxComplexityDelta ?? 0,
    rollbackPlan: input.rollbackPlan ?? "",
  };
}

/**
 * Creates a policy verdict without ever leaking sensitive values.
 */
export function policyVerdict({
  rule,
  severity = "error",
  decision,
  evidence = [],
  expiresAt = null,
}: {
  rule: string;
  severity?: Severity;
  decision: Decision;
  evidence?: any[];
  expiresAt?: string | null;
}): PolicyVerdict {
  if (!DECISIONS.includes(decision)) {
    throw new Error(`CHANGE_INVALID: unknown decision '${decision}'`);
  }
  return {
    version: CONTRACT_VERSION,
    rule,
    severity,
    decision,
    evidence,
    expiresAt,
  };
}

/**
 * Validates and normalizes policy configurations.
 */
export function normalizePolicy(input: Partial<GatePolicy> = {}): GatePolicy {
  const policy: GatePolicy = { ...DEFAULT_POLICY, ...input };
  if (!Number.isInteger(policy.maxFiles) || policy.maxFiles < 1) {
    throw new Error("POLICY_INVALID: maxFiles must be an integer >= 1");
  }
  if (!Array.isArray(policy.forbiddenPaths)) {
    throw new Error("POLICY_INVALID: forbiddenPaths must be an array");
  }
  policy._forbidden = policy.forbiddenPaths.map((p) => {
    try {
      return new RegExp(p);
    } catch {
      throw new Error(`POLICY_INVALID: bad forbiddenPaths regex '${p}'`);
    }
  });
  if (!Array.isArray(policy.requiredTestsFor)) {
    throw new Error("POLICY_INVALID: requiredTestsFor must be an array");
  }
  return policy;
}
