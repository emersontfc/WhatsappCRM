BEGIN;
ALTER TABLE public.scheduled_messages ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE public.scheduled_status ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.whatsapp_operator_settings (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 contact_alerts boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS public.whatsapp_operator_commands (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 message_id text NOT NULL CHECK (length(message_id) BETWEEN 1 AND 160),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,message_id)
);
ALTER TABLE public.whatsapp_operator_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_operator_commands FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.whatsapp_operator_commands TO service_role;
CREATE TABLE IF NOT EXISTS public.whatsapp_contact_alerts (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
 last_alert_at timestamptz NOT NULL,
 PRIMARY KEY(user_id,contact_id)
);
ALTER TABLE public.whatsapp_operator_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_contact_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_operator_settings,public.whatsapp_contact_alerts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.whatsapp_operator_settings,public.whatsapp_contact_alerts TO service_role;

CREATE OR REPLACE FUNCTION public.agentx_claim_contact_alert(p_user uuid, p_contact uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 INSERT INTO public.whatsapp_contact_alerts(user_id,contact_id,last_alert_at)
 SELECT s.user_id,c.id,now() FROM public.whatsapp_operator_settings s
 JOIN public.contacts c ON c.user_id=s.user_id
 WHERE s.user_id=p_user AND s.contact_alerts AND c.id=p_contact
 ON CONFLICT (user_id,contact_id) DO UPDATE SET last_alert_at=excluded.last_alert_at
 WHERE whatsapp_contact_alerts.last_alert_at <= now() - interval '30 minutes';
 RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.agentx_claim_contact_alert(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.agentx_claim_contact_alert(uuid,uuid) TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';
