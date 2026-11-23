BEGIN;

ALTER TABLE public.scheduled_messages
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS media_url text,
  ADD COLUMN IF NOT EXISTS media_type text,
  ADD COLUMN IF NOT EXISTS media_mimetype text,
  ADD COLUMN IF NOT EXISTS media_filename text,
  ADD COLUMN IF NOT EXISTS request_key uuid,
  ADD COLUMN IF NOT EXISTS retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispatch_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispatch_token uuid,
  ADD COLUMN IF NOT EXISTS dispatch_receipt_id text;

ALTER TABLE public.scheduled_status
  ADD COLUMN IF NOT EXISTS request_key uuid,
  ADD COLUMN IF NOT EXISTS retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispatch_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispatch_token uuid,
  ADD COLUMN IF NOT EXISTS dispatch_receipt_id text;

ALTER TABLE public.scheduled_messages ALTER COLUMN phone DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS agentx_agenda_message_request_uidx
  ON public.scheduled_messages (user_id, request_key) WHERE request_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS agentx_agenda_status_request_uidx
  ON public.scheduled_status (user_id, request_key) WHERE request_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS agentx_agenda_message_due_idx
  ON public.scheduled_messages (scheduled_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS agentx_agenda_status_due_idx
  ON public.scheduled_status (scheduled_at) WHERE status = 'pending';

-- Each recurring group post preserves the original attachment.
CREATE OR REPLACE FUNCTION public.agentx_create_next_status()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE
 anchor_local timestamp;
 local_now timestamp;
 next_at timestamptz;
 occurrence integer;
 reference_time timestamptz := greatest(now(), NEW.scheduled_at);
BEGIN
 IF OLD.status IS DISTINCT FROM 'processing' OR NEW.status IS DISTINCT FROM 'sent' OR NEW.repeat_days=0 THEN
   RETURN NEW;
 END IF;
 anchor_local := NEW.repeat_anchor_at AT TIME ZONE NEW.repeat_zone;
 local_now := reference_time AT TIME ZONE NEW.repeat_zone;
 occurrence := greatest(1,(local_now::date-anchor_local::date)/NEW.repeat_days);
 next_at := (anchor_local+make_interval(days=>occurrence*NEW.repeat_days)) AT TIME ZONE NEW.repeat_zone;
 IF next_at <= reference_time THEN
   next_at := (anchor_local+make_interval(days=>(occurrence+1)*NEW.repeat_days)) AT TIME ZONE NEW.repeat_zone;
 END IF;
 IF TG_TABLE_NAME='scheduled_messages' THEN
   IF NEW.target_type <> 'group' THEN RETURN NEW; END IF;
   INSERT INTO public.scheduled_messages(user_id,target_type,group_jid,group_name,message,scheduled_at,status,
     media_url,media_type,media_mimetype,media_filename,repeat_days,repeat_zone,repeat_anchor_at,repeat_from)
   VALUES(NEW.user_id,'group',NEW.group_jid,NEW.group_name,NEW.message,next_at,'pending',
     NEW.media_url,NEW.media_type,NEW.media_mimetype,NEW.media_filename,
     NEW.repeat_days,NEW.repeat_zone,NEW.repeat_anchor_at,NEW.id)
   ON CONFLICT (user_id,repeat_from) WHERE repeat_from IS NOT NULL DO NOTHING;
 ELSE
 INSERT INTO public.scheduled_status(user_id,media_url,media_type,caption,scheduled_at,status,
   repeat_days,repeat_zone,repeat_anchor_at,repeat_from)
 VALUES(NEW.user_id,NEW.media_url,NEW.media_type,NEW.caption,next_at,'pending',
   NEW.repeat_days,NEW.repeat_zone,NEW.repeat_anchor_at,NEW.id)
 ON CONFLICT (user_id,repeat_from) WHERE repeat_from IS NOT NULL DO NOTHING;
 END IF;
 RETURN NEW;
END;
$$;

-- A crashed worker may already have handed the message to WhatsApp. Only
-- expire its tracking state. Retrying an uncertain delivery can send twice.
CREATE OR REPLACE FUNCTION public.agentx_expire_agenda_claims()
RETURNS integer LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  total_expired integer := 0;
  expired integer;
  cutoff timestamptz := now() - interval '10 minutes';
BEGIN
  UPDATE public.scheduled_messages
  SET status = 'failed', dispatch_token = NULL,
      error = 'Envio interrompido. Confirma a entrega no WhatsApp antes de criar outro agendamento.'
  WHERE status = 'processing' AND COALESCE(dispatch_started_at, scheduled_at) < cutoff;
  GET DIAGNOSTICS expired = ROW_COUNT;
  total_expired := total_expired + expired;

  UPDATE public.scheduled_status
  SET status = 'failed', dispatch_token = NULL,
      error = 'Envio interrompido. Confirma a publicação no WhatsApp antes de criar outro agendamento.'
  WHERE status = 'processing' AND COALESCE(dispatch_started_at, scheduled_at) < cutoff;
  GET DIAGNOSTICS expired = ROW_COUNT;
  RETURN total_expired + expired;
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_schedule_dispatch_ready()
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT public.agentx_schedule_contract_ready()
    AND NOT EXISTS (
      SELECT 1 FROM (VALUES ('public.scheduled_messages'), ('public.scheduled_status')) AS expected(relation)
      CROSS JOIN (VALUES ('request_key'), ('retry_at'), ('dispatch_started_at'), ('dispatch_token'), ('dispatch_receipt_id')) AS fields(name)
      WHERE NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = to_regclass(expected.relation) AND a.attname = fields.name
          AND a.attnum > 0 AND NOT a.attisdropped
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM (VALUES ('public.agentx_agenda_message_request_uidx'), ('public.agentx_agenda_status_request_uidx')) AS expected(index_name)
      WHERE NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_index i
        WHERE i.indexrelid = to_regclass(expected.index_name) AND i.indisunique AND i.indisvalid
      )
    )
    AND to_regprocedure('public.agentx_expire_agenda_claims()') IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.agentx_schedule_dispatch_ready(), public.agentx_expire_agenda_claims()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agentx_schedule_dispatch_ready(), public.agentx_expire_agenda_claims() TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheduled_messages, public.scheduled_status TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
