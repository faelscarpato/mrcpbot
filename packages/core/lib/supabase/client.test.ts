import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  saveAstSession,
  fetchAstSession,
  getSupabaseClient,
  setSupabaseClient,
} from "./client.js";

describe("Supabase Ephemeral Memory Client", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    setSupabaseClient(null);
    process.env = { ...originalEnv };
  });

  describe("getSupabaseClient", () => {
    it("should return null if SUPABASE_URL is missing", () => {
      delete process.env.SUPABASE_URL;
      process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-key";
      expect(getSupabaseClient()).toBeNull();
    });

    it("should return null if service role key is missing", () => {
      process.env.SUPABASE_URL = "https://example.supabase.co";
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      delete process.env.SUPABASE_SERVICE_ROLE;
      expect(getSupabaseClient()).toBeNull();
    });

    it("should initialize client when credentials are present", () => {
      process.env.SUPABASE_URL = "https://example.supabase.co";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
      const client = getSupabaseClient();
      expect(client).not.toBeNull();
      expect(typeof client?.from).toBe("function");
    });
  });

  describe("saveAstSession", () => {
    it("should throw error if Supabase client is not configured", async () => {
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      delete process.env.SUPABASE_SERVICE_ROLE;

      await expect(
        saveAstSession("https://github.com/org/repo", { test: 123 }),
      ).rejects.toThrow("Supabase client não configurado");
    });

    it("should insert session and return session_id", async () => {
      const mockSessionId = "123e4567-e89b-12d3-a456-426614174000";
      const mockSingle = vi.fn().mockResolvedValue({
        data: { session_id: mockSessionId },
        error: null,
      });
      const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
      const mockInsert = vi.fn().mockReturnValue({ select: mockSelect });
      const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert });

      setSupabaseClient({ from: mockFrom } as any);

      const payload = { nodes: [{ id: "file1" }], edges: [] };
      const sessionId = await saveAstSession(
        "https://github.com/org/repo",
        payload,
      );

      expect(mockFrom).toHaveBeenCalledWith("mrcp_ast_sessions");
      expect(mockInsert).toHaveBeenCalledWith({
        repository_url: "https://github.com/org/repo",
        ast_payload: payload,
      });
      expect(mockSelect).toHaveBeenCalledWith("session_id");
      expect(sessionId).toBe(mockSessionId);
    });

    it("should throw error if database insert fails", async () => {
      const mockSingle = vi.fn().mockResolvedValue({
        data: null,
        error: { message: "Database connection failed" },
      });
      const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
      const mockInsert = vi.fn().mockReturnValue({ select: mockSelect });
      const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert });

      setSupabaseClient({ from: mockFrom } as any);

      await expect(
        saveAstSession("https://github.com/org/repo", { foo: "bar" }),
      ).rejects.toThrow("Erro ao salvar sessão AST no Supabase");
    });
    it("should throw error if payload is missing or null", async () => {
      setSupabaseClient({ from: vi.fn() } as any);

      await expect(
        saveAstSession("https://github.com/org/repo", null),
      ).rejects.toThrow("Payload da sessão AST é obrigatório.");

      await expect(
        saveAstSession("https://github.com/org/repo", undefined),
      ).rejects.toThrow("Payload da sessão AST é obrigatório.");
    });
  });

  describe("fetchAstSession", () => {
    it("should throw error if Supabase client is not configured", async () => {
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      delete process.env.SUPABASE_SERVICE_ROLE;

      await expect(
        fetchAstSession("123e4567-e89b-12d3-a456-426614174000"),
      ).rejects.toThrow("Supabase client não configurado");
    });

    it("should return null immediately for empty or whitespace sessionId", async () => {
      const mockFrom = vi.fn();
      setSupabaseClient({ from: mockFrom } as any);

      expect(await fetchAstSession("")).toBeNull();
      expect(await fetchAstSession("   ")).toBeNull();
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it("should return ast_payload when session is valid and fresh (< 24h)", async () => {
      const mockPayload = { nodes: [{ id: "A" }], edges: [] };
      const recentTimestamp = new Date(Date.now() - 3600 * 1000).toISOString(); // 1h ago

      const mockMaybeSingle = vi.fn().mockResolvedValue({
        data: {
          session_id: "valid-session-id",
          repository_url: "https://github.com/org/repo",
          ast_payload: mockPayload,
          created_at: recentTimestamp,
        },
        error: null,
      });
      const mockGt = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
      const mockEq = vi.fn().mockReturnValue({ gt: mockGt });
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

      setSupabaseClient({ from: mockFrom } as any);

      const result = await fetchAstSession("valid-session-id");
      expect(mockFrom).toHaveBeenCalledWith("mrcp_ast_sessions");
      expect(mockEq).toHaveBeenCalledWith("session_id", "valid-session-id");
      expect(result).toEqual(mockPayload);
    });

    it("should return null when session is not found", async () => {
      const mockMaybeSingle = vi.fn().mockResolvedValue({
        data: null,
        error: null,
      });
      const mockGt = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
      const mockEq = vi.fn().mockReturnValue({ gt: mockGt });
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

      setSupabaseClient({ from: mockFrom } as any);

      const result = await fetchAstSession("non-existent-session-id");
      expect(result).toBeNull();
    });

    it("should return null if session is expired (> 24 hours old)", async () => {
      const mockPayload = { nodes: [{ id: "A" }], edges: [] };
      const expiredTimestamp = new Date(
        Date.now() - 25 * 3600 * 1000,
      ).toISOString(); // 25 hours ago

      const mockMaybeSingle = vi.fn().mockResolvedValue({
        data: {
          session_id: "expired-session-id",
          repository_url: "https://github.com/org/repo",
          ast_payload: mockPayload,
          created_at: expiredTimestamp,
        },
        error: null,
      });
      const mockGt = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
      const mockEq = vi.fn().mockReturnValue({ gt: mockGt });
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

      setSupabaseClient({ from: mockFrom } as any);

      const result = await fetchAstSession("expired-session-id");
      expect(result).toBeNull();
    });

    it("should return null gracefully when Postgres returns 22P02 invalid UUID syntax", async () => {
      const mockMaybeSingle = vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: "22P02",
          message: 'invalid input syntax for type uuid: "not-a-uuid"',
        },
      });
      const mockGt = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
      const mockEq = vi.fn().mockReturnValue({ gt: mockGt });
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

      setSupabaseClient({ from: mockFrom } as any);

      const result = await fetchAstSession("not-a-uuid");
      expect(result).toBeNull();
    });

    it("should return null gracefully when table does not exist in schema cache (PGRST205)", async () => {
      const mockMaybeSingle = vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: "PGRST205",
          message: "Could not find the table in schema cache",
        },
      });
      const mockGt = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
      const mockEq = vi.fn().mockReturnValue({ gt: mockGt });
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

      setSupabaseClient({ from: mockFrom } as any);

      const result = await fetchAstSession("any-id");
      expect(result).toBeNull();
    });

    it("should throw error if Supabase query encounters an unhandled error", async () => {
      const mockMaybeSingle = vi.fn().mockResolvedValue({
        data: null,
        error: { message: "Internal server error" },
      });
      const mockGt = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
      const mockEq = vi.fn().mockReturnValue({ gt: mockGt });
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

      setSupabaseClient({ from: mockFrom } as any);

      await expect(fetchAstSession("any-id")).rejects.toThrow(
        "Erro ao buscar sessão AST: Internal server error",
      );
    });
  });
});
