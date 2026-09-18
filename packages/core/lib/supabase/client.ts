import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let customClient: SupabaseClient | null = null;
let cachedClient: SupabaseClient | null = null;
let cachedUrl: string | undefined = undefined;
let cachedKey: string | undefined = undefined;

/**
 * Obtém ou inicializa a instância singleton do cliente Supabase para o backend.
 * Utiliza SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (ou SUPABASE_SERVICE_ROLE).
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (customClient) {
    return customClient;
  }

  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;

  if (!url || !key) {
    cachedClient = null;
    cachedUrl = undefined;
    cachedKey = undefined;
    return null;
  }

  if (!cachedClient || cachedUrl !== url || cachedKey !== key) {
    cachedClient = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    cachedUrl = url;
    cachedKey = key;
  }

  return cachedClient;
}

/**
 * Permite injetar ou resetar o cliente Supabase customizado (para testes unitários com mocks).
 */
export function setSupabaseClient(client: SupabaseClient | null): void {
  customClient = client;
  if (client === null) {
    cachedClient = null;
    cachedUrl = undefined;
    cachedKey = undefined;
  }
}

/**
 * Reseta todos os clientes em cache (útil para isolamento de testes).
 */
export function resetSupabaseClient(): void {
  customClient = null;
  cachedClient = null;
  cachedUrl = undefined;
  cachedKey = undefined;
}

/**
 * Persiste o payload de uma análise AST como sessão efêmera (TTL: 24h).
 * @param repositoryUrl URL ou caminho do repositório analisado
 * @param payload Objeto contendo o resultado da análise / micro-contrato
 * @returns UUID da sessão gerada
 */
export async function saveAstSession(
  repositoryUrl: string | undefined,
  payload: any,
): Promise<string> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error(
      "Supabase client não configurado. Verifique as variáveis SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  if (payload === undefined || payload === null) {
    throw new Error("Payload da sessão AST é obrigatório.");
  }

  const { data, error } = await client
    .from("mrcp_ast_sessions")
    .insert({
      repository_url: repositoryUrl || null,
      ast_payload: payload,
    })
    .select("session_id")
    .single();

  if (error || !data?.session_id) {
    throw new Error(
      `Erro ao salvar sessão AST no Supabase: ${error?.message || "Nenhum session_id retornado"}`,
    );
  }

  return data.session_id;
}

/**
 * Recupera uma sessão AST da memória efêmera caso ainda esteja dentro do TTL de 24 horas.
 * @param sessionId UUID da sessão
 * @returns Payload do micro-contrato / AST salvo, ou null caso não exista ou esteja expirada
 */
export async function fetchAstSession(sessionId: string): Promise<any | null> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error(
      "Supabase client não configurado. Verifique as variáveis SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  const cleanId = String(sessionId || "").trim();
  if (!cleanId) {
    return null;
  }

  const twentyFourHoursAgo = new Date(
    Date.now() - 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data, error } = await client
    .from("mrcp_ast_sessions")
    .select("session_id, repository_url, ast_payload, created_at")
    .eq("session_id", cleanId)
    .gt("created_at", twentyFourHoursAgo)
    .maybeSingle();

  if (error) {
    // 22P02: sintaxe UUID inválida no Postgres (não existe sessão com este ID)
    // PGRST205: tabela não encontrada no cache do schema
    // PGRST116: nenhum registro encontrado
    if (
      error.code === "22P02" ||
      error.code === "PGRST205" ||
      error.code === "PGRST116" ||
      error.message?.includes("invalid input syntax for type uuid")
    ) {
      return null;
    }
    throw new Error(`Erro ao buscar sessão AST: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  // Validação explícita em memória contra relógios dessincronizados
  if (data.created_at) {
    const ageMs = Date.now() - new Date(data.created_at).getTime();
    if (ageMs > 24 * 60 * 60 * 1000) {
      return null;
    }
  }

  return data.ast_payload;
}
