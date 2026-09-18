-- Migration: Criação da infraestrutura de Memória Efêmera (TTL 24h)
-- Tabela: mrcp_ast_sessions

-- Habilita extensão pgcrypto caso necessário para versões legadas (em PG13+ gen_random_uuid() é nativo)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Criação da tabela mrcp_ast_sessions
CREATE TABLE IF NOT EXISTS mrcp_ast_sessions (
    session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_url TEXT,
    ast_payload JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Comentários descritivos da tabela e colunas
COMMENT ON TABLE mrcp_ast_sessions IS 'Armazena sessões efêmeras de AST e micro-contratos arquiteturais gerados pelo MRCP Engine com TTL de 24 horas.';
COMMENT ON COLUMN mrcp_ast_sessions.session_id IS 'UUID identificador único da sessão efêmera.';
COMMENT ON COLUMN mrcp_ast_sessions.repository_url IS 'URL ou identificador do repositório analisado.';
COMMENT ON COLUMN mrcp_ast_sessions.ast_payload IS 'Micro-contrato ou AST compactado retornado pelo pipeline de análise.';
COMMENT ON COLUMN mrcp_ast_sessions.created_at IS 'Timestamp de criação do registro para controle de expiração (TTL: 24h).';

-- 2. Índice em created_at para otimizar queries de busca de registros recentes e rotinas de expurgo
CREATE INDEX IF NOT EXISTS idx_mrcp_ast_sessions_created_at 
ON mrcp_ast_sessions (created_at);

-- 3. Habilita Row Level Security (RLS) para proteger dados sensíveis de acesso anônimo público
ALTER TABLE mrcp_ast_sessions ENABLE ROW LEVEL SECURITY;

-- 4. Permite acesso irrestrito para service_role (usado pelo MRCP Engine no backend)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'mrcp_ast_sessions' AND policyname = 'Allow service_role full access'
    ) THEN
        CREATE POLICY "Allow service_role full access" 
        ON mrcp_ast_sessions 
        FOR ALL 
        TO service_role 
        USING (true) 
        WITH CHECK (true);
    END IF;
END $$;

-- 5. Função de limpeza / expurgo de registros expirados (> 24h)
-- SECURITY DEFINER com search_path seguro para evitar ataques de hijacking de search_path
CREATE OR REPLACE FUNCTION purge_expired_mrcp_ast_sessions()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM public.mrcp_ast_sessions
    WHERE created_at < NOW() - INTERVAL '24 hours';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

-- 6. Rotina agendada de expurgo a cada 1 hora via extensão pg_cron
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
    ) THEN
        -- Remove agendamento prévio com o mesmo nome se existir (compatível com todas versões de pg_cron)
        PERFORM cron.unschedule(jobid)
        FROM cron.job
        WHERE jobname = 'mrcp-ast-sessions-ttl-cleanup';

        -- Agenda execução a cada 1 hora (minuto 0 de toda hora)
        PERFORM cron.schedule(
            'mrcp-ast-sessions-ttl-cleanup',
            '0 * * * *',
            'SELECT purge_expired_mrcp_ast_sessions();'
        );
    ELSE
        RAISE NOTICE 'pg_cron não está habilitado. A limpeza de sessões >24h continuará sendo filtrada no client e poderá ser expurgada via RPC ou agendamento externo.';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Não foi possível agendar pg_cron automaticamente: %', SQLERRM;
END $$;
