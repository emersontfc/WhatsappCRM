-- AgentX V2 additive multi-tenant foundation. BACK UP database before applying.
-- Existing tables and WhatsApp sessions remain untouched.
BEGIN;
CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 120),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.organization_members (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','finance_admin','operator','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,user_id)
);
CREATE TABLE IF NOT EXISTS public.agentx_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','paused')),
  definition jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id)
);
CREATE TABLE IF NOT EXISTS public.agentx_workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workflow_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed','cancelled')),
  idempotency_key text NOT NULL CHECK(length(idempotency_key)>0),
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workflow_id,organization_id) REFERENCES public.agentx_workflows(id,organization_id) ON DELETE CASCADE,
  UNIQUE(organization_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS agentx_workflows_org_status_idx ON public.agentx_workflows(organization_id,status);
CREATE INDEX IF NOT EXISTS agentx_workflow_runs_org_status_idx ON public.agentx_workflow_runs(organization_id,status,created_at);
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agentx_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agentx_workflow_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organizations, public.organization_members, public.agentx_workflows, public.agentx_workflow_runs FROM anon;
GRANT SELECT ON public.organizations, public.organization_members, public.agentx_workflows, public.agentx_workflow_runs TO authenticated;
DROP POLICY IF EXISTS agentx_org_read ON public.organizations;
CREATE POLICY agentx_org_read ON public.organizations FOR SELECT TO authenticated
USING (owner_user_id=(SELECT auth.uid()) OR EXISTS(
 SELECT 1 FROM public.organization_members m WHERE m.organization_id=id AND m.user_id=(SELECT auth.uid())
));
DROP POLICY IF EXISTS agentx_member_read ON public.organization_members;
CREATE POLICY agentx_member_read ON public.organization_members FOR SELECT TO authenticated
USING (user_id=(SELECT auth.uid()) OR EXISTS(
 SELECT 1 FROM public.organizations o WHERE o.id=organization_id AND o.owner_user_id=(SELECT auth.uid())
));
DROP POLICY IF EXISTS agentx_workflow_read ON public.agentx_workflows;
CREATE POLICY agentx_workflow_read ON public.agentx_workflows FOR SELECT TO authenticated
USING (EXISTS(SELECT 1 FROM public.organization_members m WHERE m.organization_id=agentx_workflows.organization_id AND m.user_id=(SELECT auth.uid())));
DROP POLICY IF EXISTS agentx_run_read ON public.agentx_workflow_runs;
CREATE POLICY agentx_run_read ON public.agentx_workflow_runs FOR SELECT TO authenticated
USING (EXISTS(SELECT 1 FROM public.organization_members m WHERE m.organization_id=agentx_workflow_runs.organization_id AND m.user_id=(SELECT auth.uid())));
-- Writes only via trusted service role after server-side authorization; RLS does not protect service-role operations.
COMMIT;
NOTIFY pgrst, 'reload schema';
