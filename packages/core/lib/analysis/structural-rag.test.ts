import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  searchReferenceRepositories,
  filterAndValidateStack,
  extractArchitecturalBlueprint,
  runStructuralRagPipeline,
} from "./structural-rag.js";
import { setSupabaseClient, resetSupabaseClient } from "../supabase/client.js";

describe("packages/core/lib/analysis/structural-rag.ts", () => {
  beforeEach(() => {
    resetSupabaseClient();
    vi.restoreAllMocks();
  });

  it("searches reference repositories with fallback when offline or without token", async () => {
    const repos = await searchReferenceRepositories("jwt fastify redis");
    expect(Array.isArray(repos)).toBe(true);
    expect(repos.length).toBeGreaterThanOrEqual(1);
    expect(repos[0].url).toBeDefined();
    expect(repos[0].name).toBeDefined();
  });

  it("filters and validates stack based on keywords", async () => {
    const res = await filterAndValidateStack(
      "https://github.com/fastify/fastify-jwt",
      "fastify jwt",
    );
    expect(res.isValid).toBe(true);
    expect(res.matchedKeywords).toContain("fastify");
    expect(res.matchedKeywords).toContain("jwt");
    expect(res.stackScore).toBeGreaterThanOrEqual(50);
  });

  it("extracts a compact architectural blueprint with token size < 600 tokens and sha256 provenance", async () => {
    const blueprint = await extractArchitecturalBlueprint(
      "https://github.com/example/auth-service",
      "fastify jwt",
    );

    expect(blueprint.repoUrl).toBe("https://github.com/example/auth-service");
    expect(blueprint.provenance).toBeDefined();
    expect(blueprint.provenance.contentHash).toHaveLength(64);
    expect(blueprint.types.length).toBeGreaterThan(0);
    expect(blueprint.routes.length).toBeGreaterThan(0);
    expect(blueprint.models.length).toBeGreaterThan(0);

    // Micro-contract constraint: between 50 and 600 tokens
    expect(blueprint.tokenEstimate).toBeLessThanOrEqual(600);
    expect(blueprint.tokenEstimate).toBeGreaterThanOrEqual(30);
  });

  it("executes the full pipeline and persists to Supabase with instructional footer", async () => {
    // Mock Supabase client for deterministic testing
    const fakeSessionId = "e50c40fa-808d-414f-bca1-125a8aa89c5f";
    const mockSupabase: any = {
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { session_id: fakeSessionId },
              error: null,
            }),
          }),
        }),
      }),
    };

    setSupabaseClient(mockSupabase);

    const result = await runStructuralRagPipeline({
      query: "jwt auth fastify",
      targetStack: "jwt fastify",
    });

    expect(result.query).toBe("jwt auth fastify");
    expect(result.selectedRepo).toBeDefined();
    expect(result.blueprint).toBeDefined();
    expect(result.tokenEstimate).toBeLessThanOrEqual(600);
    expect(result.isCompliant).toBe(true);
    expect(result.gateVerdict.decision).toBe("allow");
    expect(result.sessionId).toBe(fakeSessionId);
    expect(result.instructionalFooter).toContain(fakeSessionId);
    expect(result.instructionalFooter).toContain("mrcp_fetch_memory");
  });

  it("gracefully falls back when Supabase persistence is unavailable", async () => {
    const mockSupabase: any = {
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi
              .fn()
              .mockRejectedValue(new Error("Supabase network error")),
          }),
        }),
      }),
    };

    setSupabaseClient(mockSupabase);

    const result = await runStructuralRagPipeline({
      query: "jwt auth fastify",
    });

    expect(result.blueprint).toBeDefined();
    expect(result.instructionalFooter).toBeDefined();
    expect(result.instructionalFooter).toContain("mrcp_fetch_memory");
  });
});
