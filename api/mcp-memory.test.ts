import { describe, it, expect, vi, beforeEach } from "vitest";
import { TOOLS } from "./mcp-tools.js";
import { executeTool } from "./mcp-executor.js";
import * as supabaseClient from "../packages/core/lib/supabase/client.js";

describe("MCP Memory Integration (mrcp_fetch_memory)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("Tool Schema in TOOLS", () => {
    it("should have mrcp_fetch_memory declared in TOOLS", () => {
      const tool = TOOLS.find((t) => t.name === "mrcp_fetch_memory");
      expect(tool).toBeDefined();
      expect(tool?.description).toContain("[Category: Core Engine / Memory]");
      expect(tool?.description).toContain("24h TTL");
      expect(tool?.inputSchema.required).toContain("session_id");
      const properties = tool?.inputSchema.properties as
        Record<string, { type?: string }> | undefined;
      expect(properties?.session_id?.type).toBe("string");
    });
  });

  describe("executeTool - mrcp_fetch_memory", () => {
    it("should return an error when session_id is missing", async () => {
      const res = await executeTool("mrcp_fetch_memory", {});
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain(
        "Error: 'session_id' parameter is required.",
      );
    });

    it("should return an error when session_id is whitespace only", async () => {
      const res = await executeTool("mrcp_fetch_memory", {
        session_id: "   ",
      });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain(
        "Error: 'session_id' parameter is required.",
      );
    });

    it("should return instructional message when session is not found or expired", async () => {
      vi.spyOn(supabaseClient, "fetchAstSession").mockResolvedValue(null);

      const res = await executeTool("mrcp_fetch_memory", {
        session_id: "non-existent-or-expired-uuid",
      });

      expect(res.isError).toBeFalsy();
      expect(res.content[0].text).toBe(
        "Sessão expirada. Execute a ferramenta de análise original novamente.",
      );
    });

    it("should return the stored payload when session is valid", async () => {
      const samplePayload = {
        repository: "https://github.com/org/repo",
        summary: { totalFiles: 10, totalNodes: 50 },
        nodes: [{ id: "index.ts" }],
      };

      vi.spyOn(supabaseClient, "fetchAstSession").mockResolvedValue(
        samplePayload,
      );

      const res = await executeTool("mrcp_fetch_memory", {
        session_id: "valid-session-uuid",
      });

      expect(res.isError).toBeFalsy();
      expect(JSON.parse(res.content[0].text)).toEqual(samplePayload);
    });

    it("should handle exceptions from fetchAstSession cleanly", async () => {
      vi.spyOn(supabaseClient, "fetchAstSession").mockRejectedValue(
        new Error("Connection timeout"),
      );

      const res = await executeTool("mrcp_fetch_memory", {
        session_id: "any-session-uuid",
      });

      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain(
        "Erro ao recuperar memória da sessão: Connection timeout",
      );
    });
  });

  describe("Footer injection in primary analysis tools", () => {
    it("should inject instructional footer in analyze_repository when saveAstSession succeeds", async () => {
      vi.spyOn(supabaseClient, "saveAstSession").mockResolvedValue(
        "test-session-123",
      );

      const res = await executeTool("analyze_repository", {
        repo: process.cwd(),
      });

      expect(res.isError).toBeFalsy();
      expect(res.content[0].text).toContain(
        "Contexto arquitetural salvo temporariamente (TTL: 24h). ID da Sessão: test-session-123.",
      );
      expect(res.content[0].text).toContain(
        "Utilize exclusivamente a ferramenta mrcp_fetch_memory(session_id).",
      );
    }, 90000);

    it("should inject instructional footer in mrcp_run_full_repository_suite when saveAstSession succeeds", async () => {
      vi.spyOn(supabaseClient, "saveAstSession").mockResolvedValue(
        "suite-session-456",
      );

      const res = await executeTool("mrcp_run_full_repository_suite", {
        repo: process.cwd(),
      });

      expect(res.isError).toBeFalsy();
      expect(res.content[0].text).toContain(
        "Contexto arquitetural salvo temporariamente (TTL: 24h). ID da Sessão: suite-session-456.",
      );
      expect(res.content[0].text).toContain(
        "Utilize exclusivamente a ferramenta mrcp_fetch_memory(session_id).",
      );
    }, 90000);

    it("should gracefully return analysis if saveAstSession fails", async () => {
      vi.spyOn(supabaseClient, "saveAstSession").mockRejectedValue(
        new Error("Supabase unavailable"),
      );

      const res = await executeTool("analyze_repository", {
        repo: process.cwd(),
      });

      expect(res.isError).toBeFalsy();
      expect(res.content[0].text).not.toContain(
        "Contexto arquitetural salvo temporariamente",
      );
    }, 90000);
  });
});
