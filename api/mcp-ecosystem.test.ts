import { describe, it, expect } from "vitest";
import { TOOLS } from "./mcp-tools.js";
import { executeTool } from "./mcp-executor.js";
import { routeHandlers } from "./routes.js";

describe("MCP Ecosystem Extensions (Gate & Structural RAG)", () => {
  describe("mrcp_gate_change", () => {
    it("is declared in TOOLS with valid input schema", () => {
      const tool = TOOLS.find((t) => t.name === "mrcp_gate_change");
      expect(tool).toBeDefined();
      expect(tool?.description).toContain("Governance & Mutation Gate");
      expect(tool?.inputSchema.required).toContain("change");
    });

    it("evaluates a clean change via executeTool", async () => {
      const res = await executeTool("mrcp_gate_change", {
        change: {
          repo: "https://github.com/org/app",
          files: [
            {
              path: "src/utils.ts",
              content: "export const square = (n: number) => n * n;\n",
              hasTests: true,
            },
          ],
        },
      });

      expect(res.isError).toBeFalsy();
      const parsed = JSON.parse(res.content[0].text);
      expect(parsed.decision).toBe("allow");
      expect(parsed.code).toBe("POLICY_ALLOW");
    });

    it("evaluates and denies forbidden paths via executeTool", async () => {
      const res = await executeTool("mrcp_gate_change", {
        change: {
          files: [{ path: ".env", content: "SECRET=123" }],
        },
      });

      expect(res.isError).toBeFalsy();
      const parsed = JSON.parse(res.content[0].text);
      expect(parsed.decision).toBe("deny");
      expect(
        parsed.verdicts.some((v: any) => v.rule === "forbidden_path"),
      ).toBe(true);
    });

    it("handles missing change parameter error", async () => {
      const res = await executeTool("mrcp_gate_change", {});
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain(
        "Error: 'change' parameter is required.",
      );
    });
  });

  describe("mrcp_structural_rag_pipeline", () => {
    it("is declared in TOOLS with valid input schema", () => {
      const tool = TOOLS.find((t) => t.name === "mrcp_structural_rag_pipeline");
      expect(tool).toBeDefined();
      expect(tool?.description).toContain("Structural RAG");
      expect(tool?.inputSchema.required).toContain("query");
    });

    it("runs pipeline via executeTool", async () => {
      const res = await executeTool("mrcp_structural_rag_pipeline", {
        query: "fastify auth jwt",
      });

      expect(res.isError).toBeFalsy();
      expect(res.content[0].text).toContain("mrcp_fetch_memory");
      expect(res.content[0].text).toContain("fastify");
    });

    it("handles missing query parameter error", async () => {
      const res = await executeTool("mrcp_structural_rag_pipeline", {});
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain(
        "Error: 'query' parameter is required.",
      );
    });
  });

  describe("REST Endpoints in api/routes.ts", () => {
    it("handles POST /api/mutation-gate", async () => {
      let sentStatus = 200;
      let sentBody: any = null;

      const req: any = {
        method: "POST",
        headers: {},
        body: {
          change: {
            files: [
              {
                path: "src/service.ts",
                content: "export const ok = true;\n",
                hasTests: true,
              },
            ],
          },
        },
        query: {},
      };

      const res: any = {
        status(code: number) {
          sentStatus = code;
          return res;
        },
        json(data: any) {
          sentBody = data;
          return res;
        },
        send(data: any) {
          sentBody = data;
          return res;
        },
        setHeader() {},
      };

      await routeHandlers["/api/mutation-gate"](req, res);
      expect(sentStatus).toBe(200);
      expect(sentBody).toBeDefined();
      expect(sentBody.decision).toBe("allow");
    });

    it("handles POST /api/structural-rag", async () => {
      let sentStatus = 200;
      let sentBody: any = null;

      const req: any = {
        method: "POST",
        headers: {},
        body: {
          query: "redis caching fastify",
        },
        query: {},
      };

      const res: any = {
        status(code: number) {
          sentStatus = code;
          return res;
        },
        json(data: any) {
          sentBody = data;
          return res;
        },
        send(data: any) {
          sentBody = data;
          return res;
        },
        setHeader() {},
      };

      await routeHandlers["/api/structural-rag"](req, res);
      expect(sentStatus).toBe(200);
      expect(sentBody).toBeDefined();
      expect(sentBody.blueprint).toBeDefined();
      expect(sentBody.tokenEstimate).toBeLessThanOrEqual(600);
    });
  });
});
