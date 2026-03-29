-- Create logs table
CREATE TABLE IF NOT EXISTS public.logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  level TEXT NOT NULL DEFAULT 'info', -- info, warn, error, debug
  source TEXT NOT NULL DEFAULT 'backend', -- backend, frontend, worker
  category TEXT, -- auth, subscription, whatsapp, ai, system
  message TEXT NOT NULL,
  details JSONB DEFAULT '{}'::jsonb,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Only admins can view logs
CREATE POLICY "Admins can view all logs" ON public.logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Only service role or specific backend logic should insert logs usually,
-- but we might allow authenticated users to insert frontend logs.
CREATE POLICY "Users can insert logs" ON public.logs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_logs_created_at ON public.logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_level ON public.logs (level);
CREATE INDEX IF NOT EXISTS idx_logs_source ON public.logs (source);
CREATE INDEX IF NOT EXISTS idx_logs_user_id ON public.logs (user_id);
