import { describe, it, expect } from "vitest";
import { normalizePolicy, contentHash } from "./contracts.js";
import { evaluateMutation, scanSecrets } from "./gate.js";

const basePolicy = normalizePolicy({});

function makeChange(files: any[], extra = {}) {
  return { repo: "local", commit: "test-commit-42", files, ...extra };
}

describe("packages/core/lib/governance/gate.ts", () => {
  it("allows a clean change within budget and policies", () => {
    const r = evaluateMutation(
      makeChange([
        {
          path: "src/calculator.ts",
          content: "export const add = (a: number, b: number) => a + b;\n",
          complexityDelta: 1,
          hasTests: true,
        },
      ]),
      basePolicy,
    );
    expect(r.decision).toBe("allow");
    expect(r.code).toBe("POLICY_ALLOW");
    expect(r.verdicts).toHaveLength(0);
    expect(r.provenance.commit).toBe("test-commit-42");
    expect(r.contract.targets).toEqual(["src/calculator.ts"]);
  });

  it("denies changes that exceed maxFiles limit", () => {
    const files = Array.from({ length: 6 }, (_, i) => ({
      path: `src/mod${i}.ts`,
      content: "console.log('test');\n",
      hasTests: true,
    }));
    const r = evaluateMutation(makeChange(files), basePolicy);
    expect(r.decision).toBe("deny");
    expect(r.code).toBe("POLICY_DENIED");
    const v = r.verdicts.find((x) => x.rule === "max_files");
    expect(v).toBeDefined();
    expect(v?.decision).toBe("deny");
    expect(v?.evidence).toHaveLength(6);
  });

  it("denies modifications to forbidden paths (.env, ssh keys, secrets)", () => {
    const forbiddenList = [
      ".env",
      ".env.production",
      "secrets/key.json",
      "id_rsa",
      "server.pem",
    ];

    for (const forbiddenPath of forbiddenList) {
      const r = evaluateMutation(
        makeChange([
          { path: forbiddenPath, content: "DUMMY=1", hasTests: true },
        ]),
        basePolicy,
      );
      expect(r.decision).toBe("deny");
      expect(r.verdicts.some((v) => v.rule === "forbidden_path")).toBe(true);
    }
  });

  it("detects and redacts secret leaks without exposing the secret in the verdict", () => {
    const secretsToTest = [
      { name: "aws-access-key", val: ["AKIA", "IOSFODNN7EXAMPLE"].join("") },
      {
        name: "github-token",
        val: ["ghp_", "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"].join(""),
      },
      {
        name: "supabase-secret",
        val: ["sb_", "secret_abcdefghijklmnopqrstuvwxyz1234"].join(""),
      },
      {
        name: "password-assign",
        val: ["pass", "word = 'SuperSecretPassword123!'"].join(""),
      },
      {
        name: "generic-api-key",
        val: ["api", "_key: 'abcdef1234567890abcdef'"].join(""),
      },
    ];

    for (const item of secretsToTest) {
      const r = evaluateMutation(
        makeChange([
          {
            path: "src/auth.ts",
            content: `// Secret injection test\nconst cred = "${item.val}";\n`,
            hasTests: true,
          },
        ]),
        basePolicy,
      );

      expect(r.decision).toBe("deny");
      const v = r.verdicts.find((x) => x.rule === "secret_leak");
      expect(v).toBeDefined();
      expect(v?.evidence[0].patterns).toContain(item.name);

      // CRITICAL: The actual secret value MUST NOT be present in any output serialized JSON
      const serialized = JSON.stringify(r);
      expect(serialized.includes(item.val)).toBe(false);
    }
  });

  it("warns on complexity over warn threshold and denies over max budget", () => {
    const warnRes = evaluateMutation(
      makeChange([
        {
          path: "src/a.ts",
          content: "a\n",
          complexityDelta: 7,
          hasTests: true,
        },
      ]),
      basePolicy,
    );
    expect(warnRes.decision).toBe("warn");
    expect(warnRes.code).toBe("POLICY_WARN");
    expect(warnRes.verdicts.some((v) => v.rule === "complexity_budget")).toBe(
      true,
    );

    const denyRes = evaluateMutation(
      makeChange([
        {
          path: "src/a.ts",
          content: "a\n",
          complexityDelta: 12,
          hasTests: true,
        },
      ]),
      basePolicy,
    );
    expect(denyRes.decision).toBe("deny");
    expect(denyRes.code).toBe("POLICY_DENIED");
    expect(denyRes.verdicts.some((v) => v.rule === "complexity_budget")).toBe(
      true,
    );
  });

  it("calculates real AST complexity from code content when checkRealComplexity is enabled", () => {
    const complexSnippet = `
      function test(x: number) {
        if (x > 0 && x < 10) {
          for (let i = 0; i < x; i++) {
            if (i % 2 === 0 || i === 3) {
              console.log(i);
            }
          }
        }
      }
    `;

    const r = evaluateMutation(
      makeChange([
        { path: "src/compute.ts", content: complexSnippet, hasTests: true },
      ]),
      basePolicy,
      { checkRealComplexity: true },
    );

    // Cyclomatic complexity of the snippet: 1 + if(1) + &&(1) + for(1) + if(1) + ||(1) = 6
    // Which is > warnComplexityDelta (5), so decision should be "warn"
    expect(r.decision).toBe("warn");
    const v = r.verdicts.find((x) => x.rule === "complexity_budget");
    expect(v).toBeDefined();
    expect(v?.evidence[0].totalDelta).toBeGreaterThanOrEqual(6);
  });

  it("warns on missing tests for files in required test prefixes (src/ and packages/)", () => {
    const rSrc = evaluateMutation(
      makeChange([
        {
          path: "src/untested.ts",
          content: "export const foo = 1;\n",
          hasTests: false,
        },
      ]),
      basePolicy,
    );
    expect(rSrc.decision).toBe("warn");
    expect(rSrc.verdicts.some((x) => x.rule === "missing_tests")).toBe(true);

    const rPkg = evaluateMutation(
      makeChange([
        {
          path: "packages/core/lib/untested-module.ts",
          content: "export const bar = 2;\n",
          hasTests: false,
        },
      ]),
      basePolicy,
    );
    expect(rPkg.decision).toBe("warn");
    expect(rPkg.verdicts.some((x) => x.rule === "missing_tests")).toBe(true);
  });

  it("detects existing test files on filesystem without requiring hasTests flag", () => {
    // packages/core/lib/governance/gate.ts has a sibling gate.test.ts on disk
    const r = evaluateMutation(
      makeChange([
        {
          path: "packages/core/lib/governance/gate.ts",
          content: "// dummy update",
        },
      ]),
      basePolicy,
    );
    // Should NOT warn on missing_tests because gate.test.ts exists on disk
    expect(r.verdicts.some((x) => x.rule === "missing_tests")).toBe(false);
  });

  it("generates deterministic sha256 cryptographic provenance", () => {
    const content = "export const version = '2.6.0';";
    const hash = contentHash(content);
    expect(hash).toHaveLength(64);

    const r = evaluateMutation(
      makeChange([{ path: "src/version.ts", content, hasTests: true }]),
      basePolicy,
    );
    expect(r.decision).toBe("allow");
  });

  it("rejects invalid change inputs and bad policy regexes", () => {
    expect(() => evaluateMutation(null as any, basePolicy)).toThrow(
      "CHANGE_INVALID",
    );
    expect(() => evaluateMutation({} as any, basePolicy)).toThrow(
      "CHANGE_INVALID",
    );
    expect(() => normalizePolicy({ maxFiles: 0 })).toThrow("POLICY_INVALID");
    expect(() => normalizePolicy({ forbiddenPaths: ["(["] })).toThrow(
      "POLICY_INVALID",
    );
  });
});
