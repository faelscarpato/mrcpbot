export type SupportedProvider =
  "gemini" | "openai" | "claude" | "nvidia" | "custom";

export interface ModelOption {
  id: string;
  name: string;
  description?: string;
  contextWindow?: string;
  recommended?: boolean;
}

export interface ProviderConfig {
  provider: SupportedProvider;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  customName?: string;
}

export const PRECONFIGURED_MODELS: Record<SupportedProvider, ModelOption[]> = {
  gemini: [
    {
      id: "gemini-2.5-flash",
      name: "Gemini 2.5 Flash",
      description:
        "Recomendado · Ultra rápido, raciocínio ágil e alta economia de tokens",
      recommended: true,
    },
    {
      id: "gemini-2.5-pro",
      name: "Gemini 2.5 Pro",
      description:
        "Auditorias profundas, arquitetura complexa e raciocínio multi-passo",
    },
    {
      id: "gemini-3.1-pro-preview",
      name: "Gemini 3.1 Pro Preview",
      description: "Nova geração avançada com capacidades estendidas de código",
    },
    {
      id: "gemini-3.1-flash-lite",
      name: "Gemini 3.1 Flash Lite",
      description: "Máxima velocidade para consultas rápidas e análise pontual",
    },
    {
      id: "gemini-flash-latest",
      name: "Gemini Flash Latest",
      description: "Alias sempre atualizado da versão estável do Gemini Flash",
    },
  ],
  openai: [
    {
      id: "gpt-4o",
      name: "GPT-4o",
      description: "Modelo flagship multimodal de alta precisão",
      recommended: true,
    },
    {
      id: "gpt-4o-mini",
      name: "GPT-4o Mini",
      description: "Leve, eficiente e com custo de tokens reduzido",
    },
    {
      id: "o3-mini",
      name: "o3-mini",
      description: "Raciocínio lógico avançado para engenharia de software",
    },
    {
      id: "o1",
      name: "o1",
      description: "Raciocínio aprofundado para problemas complexos de código",
    },
    {
      id: "gpt-4.5-preview",
      name: "GPT-4.5 Preview",
      description: "Maior capacidade contextual e compreensão de dependências",
    },
  ],
  claude: [
    {
      id: "claude-3-7-sonnet-20250219",
      name: "Claude 3.7 Sonnet",
      description:
        "Estado da arte · Raciocínio híbrido e precisão cirúrgica de código",
      recommended: true,
    },
    {
      id: "claude-3-5-sonnet-latest",
      name: "Claude 3.5 Sonnet",
      description:
        "Altíssima performance em refatoração e engenharia de software",
    },
    {
      id: "claude-3-5-haiku-latest",
      name: "Claude 3.5 Haiku",
      description: "Ultra rápido e econômico para validações imediatas",
    },
    {
      id: "claude-3-opus-latest",
      name: "Claude 3 Opus",
      description: "Compreensão de código denso e arquitetura de grande porte",
    },
  ],
  nvidia: [
    {
      id: "meta/llama-3.3-70b-instruct",
      name: "Llama 3.3 70B Instruct (NVIDIA NIM)",
      description: "Modelo aberto de alta performance hospedado via NVIDIA NIM",
      recommended: true,
    },
    {
      id: "deepseek-ai/deepseek-r1",
      name: "DeepSeek R1 (NVIDIA NIM)",
      description: "Raciocínio analítico avançado e geração de diagnósticos",
    },
    {
      id: "mistralai/mistral-large-2-instruct",
      name: "Mistral Large 2 (NVIDIA NIM)",
      description: "Capacidade multi-idioma e arquitetura de software precisa",
    },
    {
      id: "nvidia/llama-3.1-nemotron-70b-instruct",
      name: "Llama 3.1 Nemotron 70B",
      description: "Otimizado para síntese técnica e precisão em respostas",
    },
  ],
  custom: [
    {
      id: "default-model",
      name: "Modelo Padrão do Provedor",
      description:
        "Insira a URL e Chave para carregar os modelos disponíveis na conta",
      recommended: true,
    },
  ],
};

/**
 * Consulta a API do provedor em tempo real para obter a lista viva de modelos da conta do usuário.
 */
export async function listProviderModels(config: {
  provider: SupportedProvider;
  apiKey?: string;
  baseUrl?: string;
}): Promise<ModelOption[]> {
  const { provider, apiKey, baseUrl } = config;
  const fallbackList =
    PRECONFIGURED_MODELS[provider] || PRECONFIGURED_MODELS.gemini;

  try {
    if (provider === "gemini") {
      const effectiveKey = apiKey || process.env.GEMINI_API_KEY;
      if (!effectiveKey) return fallbackList;

      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${effectiveKey}`;
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
      });

      if (res.ok) {
        const data = (await res.json()) as any;
        if (Array.isArray(data.models)) {
          const list: ModelOption[] = data.models
            .filter(
              (m: any) =>
                (m.supportedGenerationMethods || []).includes(
                  "generateContent",
                ) &&
                (m.name?.includes("gemini") ||
                  m.displayName?.toLowerCase().includes("gemini")),
            )
            .map((m: any) => {
              const id = m.name?.replace(/^models\//, "") || m.name;
              return {
                id,
                name: m.displayName || id,
                description: m.description
                  ? m.description.slice(0, 100) + "..."
                  : undefined,
                recommended:
                  id === "gemini-2.5-flash" || id === "gemini-flash-latest",
              };
            });

          if (list.length > 0) {
            // Garante que os modelos principais apareçam primeiro
            list.sort((a, b) => {
              if (a.id === "gemini-2.5-flash") return -1;
              if (b.id === "gemini-2.5-flash") return 1;
              return a.name.localeCompare(b.name);
            });
            return list;
          }
        }
      }
      return fallbackList;
    }

    if (provider === "openai") {
      if (!apiKey) return fallbackList;
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
      });

      if (res.ok) {
        const data = (await res.json()) as any;
        if (Array.isArray(data.data)) {
          const chatModels = data.data
            .filter(
              (m: any) =>
                m.id.startsWith("gpt-4") ||
                m.id.startsWith("o1") ||
                m.id.startsWith("o3") ||
                m.id.startsWith("chatgpt"),
            )
            .map((m: any) => ({
              id: m.id,
              name: m.id,
              description: `Modelo oficial OpenAI (${m.id})`,
              recommended: m.id === "gpt-4o" || m.id === "gpt-4o-mini",
            }));

          if (chatModels.length > 0) {
            chatModels.sort((a: ModelOption, b: ModelOption) => {
              if (a.id === "gpt-4o") return -1;
              if (b.id === "gpt-4o") return 1;
              return a.id.localeCompare(b.id);
            });
            return chatModels;
          }
        }
      }
      return fallbackList;
    }

    if (provider === "nvidia") {
      const base = baseUrl?.trim() || "https://integrate.api.nvidia.com/v1";
      if (!apiKey) return fallbackList;
      const res = await fetch(`${base.replace(/\/+$/, "")}/models`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
      });

      if (res.ok) {
        const data = (await res.json()) as any;
        if (Array.isArray(data.data)) {
          const models = data.data.map((m: any) => ({
            id: m.id,
            name: m.id,
            description: `NVIDIA NIM Model: ${m.id}`,
            recommended: m.id.includes("llama-3.3-70b"),
          }));
          if (models.length > 0) return models;
        }
      }
      return fallbackList;
    }

    if (provider === "custom") {
      const base = baseUrl?.trim();
      if (!base) return fallbackList;

      const headers: Record<string, string> = { Accept: "application/json" };
      if (apiKey?.trim()) {
        headers["Authorization"] = `Bearer ${apiKey.trim()}`;
      }

      const cleanBase = base.replace(/\/+$/, "");
      const targetUrl = cleanBase.endsWith("/v1")
        ? `${cleanBase}/models`
        : `${cleanBase}/v1/models`;

      // Timeout curto de 6s para testar conexão
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      try {
        let res = await fetch(targetUrl, {
          headers,
          signal: controller.signal,
        });
        if (!res.ok && targetUrl.includes("/v1/models")) {
          // Tenta endpoint direto sem /v1
          res = await fetch(`${cleanBase}/models`, {
            headers,
            signal: controller.signal,
          });
        }
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = (await res.json()) as any;
          const items = Array.isArray(data.data)
            ? data.data
            : Array.isArray(data.models)
              ? data.models
              : [];
          if (items.length > 0) {
            return items.map((m: any) => {
              const id = typeof m === "string" ? m : m.id || m.name;
              return {
                id,
                name: typeof m === "string" ? m : m.name || m.id,
                description: `Disponível no servidor custom (${id})`,
                recommended: false,
              };
            });
          }
        }
      } catch (e) {
        clearTimeout(timeoutId);
        console.warn("Erro ao consultar /models no provedor custom:", e);
      }
      return fallbackList;
    }

    // claude não possui endpoint público simples de listagem de modelos sem headers de autenticação adicionais, usa lista canônica atualizada
    return fallbackList;
  } catch (err) {
    console.warn(`Erro ao listar modelos para provedor ${provider}:`, err);
    return fallbackList;
  }
}

/**
 * Executa completion em provedores compatíveis com a especificação OpenAI (OpenAI, NVIDIA NIM, Custom, Ollama, vLLM, OpenRouter)
 */
export async function executeOpenAiCompatibleChat(params: {
  baseUrl: string;
  apiKey?: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  systemInstruction: string;
}): Promise<{
  reply: string;
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
}> {
  const { baseUrl, apiKey, model, messages, systemInstruction } = params;
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const targetUrl = cleanBase.endsWith("/v1")
    ? `${cleanBase}/chat/completions`
    : `${cleanBase}/v1/chat/completions`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (apiKey?.trim()) {
    headers["Authorization"] = `Bearer ${apiKey.trim()}`;
  }

  const payloadMessages = [
    { role: "system", content: systemInstruction },
    ...messages.map((m) => ({
      role: m.role === "model" ? "assistant" : m.role,
      content: m.content,
    })),
  ];

  const res = await fetch(targetUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: payloadMessages,
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `Falha na API do provedor (${res.status}): ${errText.slice(0, 300)}`,
    );
  }

  const json = (await res.json()) as any;
  const reply = json.choices?.[0]?.message?.content || "";
  const promptTokens = json.usage?.prompt_tokens || 0;
  const candidatesTokens = json.usage?.completion_tokens || 0;
  const totalTokens =
    json.usage?.total_tokens || promptTokens + candidatesTokens;

  return { reply, promptTokens, candidatesTokens, totalTokens };
}

/**
 * Executa completion no Anthropic Claude
 */
export async function executeClaudeChat(params: {
  apiKey: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  systemInstruction: string;
}): Promise<{
  reply: string;
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
}> {
  const { apiKey, model, messages, systemInstruction } = params;

  const payloadMessages = messages.map((m) => ({
    role: m.role === "model" ? "assistant" : "user",
    content: m.content,
  }));

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      system: systemInstruction,
      messages: payloadMessages,
      max_tokens: 4096,
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `Falha na API Claude (${res.status}): ${errText.slice(0, 300)}`,
    );
  }

  const json = (await res.json()) as any;
  const reply = json.content?.[0]?.text || "";
  const promptTokens = json.usage?.input_tokens || 0;
  const candidatesTokens = json.usage?.output_tokens || 0;
  const totalTokens = promptTokens + candidatesTokens;

  return { reply, promptTokens, candidatesTokens, totalTokens };
}
