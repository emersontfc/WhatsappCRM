-- ==============================================================================
-- KAZIX AGENTX 2.0 — COMMERCE, PAYMENTS, PROOF EXTRACTION & OPERATIONS
-- Migration 08: Universal Agent Brain, Orders, Verifications & Audit Timeline
-- ==============================================================================

-- 1. Tabela de Produtos / Catálogo Comercial
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    price NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    currency TEXT NOT NULL DEFAULT 'MT',
    category TEXT DEFAULT 'Geral',
    stock INTEGER DEFAULT 999,
    is_active BOOLEAN DEFAULT TRUE,
    type TEXT DEFAULT 'digital', -- 'digital', 'service', 'package', 'physical'
    digital_content TEXT DEFAULT '', -- link para download, código de licença, credenciais ou instruções
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_user_id ON products(user_id);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(user_id, is_active);

-- 2. Tabela de Pedidos / Vendas
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number TEXT NOT NULL,
    user_id UUID NOT NULL,
    contact_id UUID,
    customer_name TEXT DEFAULT '',
    customer_phone TEXT NOT NULL,
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    currency TEXT NOT NULL DEFAULT 'MT',
    status TEXT NOT NULL DEFAULT 'created', -- 'created', 'awaiting_payment', 'verification_pending', 'paid', 'fulfilled', 'rejected', 'expired', 'cancelled', 'refunded', 'failed'
    payment_method TEXT DEFAULT 'mpesa', -- 'mpesa', 'emola', 'bank_transfer', 'reference', 'other'
    payment_reference TEXT DEFAULT '',
    proof_url TEXT DEFAULT '',
    proof_data JSONB DEFAULT '{}'::jsonb,
    verification_notes TEXT DEFAULT '',
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    rejected_reason TEXT DEFAULT '',
    fulfilled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer_phone ON orders(user_id, customer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(user_id, status);

-- 3. Itens do Pedido
CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    total_price NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

-- 4. Verificações de Pagamento (Comprovativos M-Pesa, e-Mola, Bancários)
CREATE TABLE IF NOT EXISTS payment_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    user_id UUID NOT NULL,
    customer_phone TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'mpesa', -- 'mpesa', 'emola', 'bank_transfer', 'reference', 'other'
    transaction_reference TEXT DEFAULT '',
    amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    currency TEXT DEFAULT 'MT',
    sender_phone TEXT DEFAULT '',
    sender_name TEXT DEFAULT '',
    proof_type TEXT DEFAULT 'sms', -- 'sms', 'image', 'pdf', 'text'
    proof_raw_text TEXT DEFAULT '',
    proof_media_url TEXT DEFAULT '',
    extracted_data JSONB DEFAULT '{}'::jsonb,
    confidence_score NUMERIC(5,2) DEFAULT 0.00,
    status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
    reviewed_by UUID,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_verifications_user ON payment_verifications(user_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_verifications_order ON payment_verifications(order_id);

-- 5. Linha Temporal de Operações do Agente (Operations Center Timeline)
CREATE TABLE IF NOT EXISTS agent_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    contact_id UUID,
    phone TEXT NOT NULL,
    step TEXT NOT NULL, -- 'initiated', 'product_selected', 'order_created', 'payment_instructions_sent', 'proof_submitted', 'verification_pending', 'admin_approved', 'admin_rejected', 'fulfilled'
    description TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_ops_user_order ON agent_operations(user_id, order_id);
CREATE INDEX IF NOT EXISTS idx_agent_ops_phone ON agent_operations(user_id, phone);

-- 6. Configurações Estendidas para a Tabela 'agents'
ALTER TABLE agents ADD COLUMN IF NOT EXISTS specialization TEXT DEFAULT 'multifuncional';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS autonomy_level TEXT DEFAULT 'hybrid';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS risk_tolerance TEXT DEFAULT 'moderate';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS enabled_tools TEXT[] DEFAULT ARRAY['crm', 'sales', 'payments', 'marketing', 'scheduling'];
ALTER TABLE agents ADD COLUMN IF NOT EXISTS financial_limit NUMERIC(12,2) DEFAULT 5000.00;

-- 7. Notificar PostgREST para recarregar o schema cache
NOTIFY pgrst, 'reload schema';
