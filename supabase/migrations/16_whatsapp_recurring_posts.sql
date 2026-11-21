BEGIN;
ALTER TABLE public.scheduled_status ADD COLUMN IF NOT EXISTS repeat_days integer NOT NULL DEFAULT 0;
ALTER TABLE public.scheduled_status ADD COLUMN IF NOT EXISTS repeat_zone text;
ALTER TABLE public.scheduled_status ADD COLUMN IF NOT EXISTS repeat_anchor_at timestamptz;
ALTER TABLE public.scheduled_status ADD COLUMN IF NOT EXISTS repeat_from uuid;
CREATE UNIQUE INDEX IF NOT EXISTS agentx_status_occurrence_uidx ON public.scheduled_status(user_id,repeat_from)
 WHERE repeat_from IS NOT NULL;

ALTER TABLE public.scheduled_messages ALTER COLUMN contact_id DROP NOT NULL;
ALTER TABLE public.scheduled_messages ADD COLUMN IF NOT EXISTS target_type text DEFAULT 'contact';
ALTER TABLE public.scheduled_messages ADD COLUMN IF NOT EXISTS group_jid text;
ALTER TABLE public.scheduled_messages ADD COLUMN IF NOT EXISTS group_name text;
ALTER TABLE public.scheduled_messages ADD COLUMN IF NOT EXISTS repeat_days integer NOT NULL DEFAULT 0;
ALTER TABLE public.scheduled_messages ADD COLUMN IF NOT EXISTS repeat_zone text;
ALTER TABLE public.scheduled_messages ADD COLUMN IF NOT EXISTS repeat_anchor_at timestamptz;
ALTER TABLE public.scheduled_messages ADD COLUMN IF NOT EXISTS repeat_from uuid;
CREATE UNIQUE INDEX IF NOT EXISTS agentx_group_post_occurrence_uidx ON public.scheduled_messages(user_id,repeat_from)
 WHERE repeat_from IS NOT NULL;

CREATE OR REPLACE FUNCTION public.agentx_validate_status_repeat()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.repeat_days NOT IN (0,1,7) OR (NEW.repeat_days > 0 AND (
   NEW.repeat_anchor_at IS NULL OR NOT isfinite(NEW.repeat_anchor_at) OR NOT EXISTS (
     SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=NEW.repeat_zone
   )
 )) THEN RAISE EXCEPTION 'Recorrência inválida'; END IF;
 RETURN NEW;
END;
$$;

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
     repeat_days,repeat_zone,repeat_anchor_at,repeat_from)
   VALUES(NEW.user_id,'group',NEW.group_jid,NEW.group_name,NEW.message,next_at,'pending',
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

DROP TRIGGER IF EXISTS agentx_validate_status_repeat ON public.scheduled_status;
CREATE TRIGGER agentx_validate_status_repeat BEFORE INSERT OR UPDATE OF repeat_days,repeat_zone,repeat_anchor_at
 ON public.scheduled_status FOR EACH ROW EXECUTE FUNCTION public.agentx_validate_status_repeat();
DROP TRIGGER IF EXISTS agentx_create_next_status ON public.scheduled_status;
CREATE TRIGGER agentx_create_next_status AFTER UPDATE OF status ON public.scheduled_status
 FOR EACH ROW EXECUTE FUNCTION public.agentx_create_next_status();

DROP TRIGGER IF EXISTS agentx_validate_group_repeat ON public.scheduled_messages;
CREATE TRIGGER agentx_validate_group_repeat BEFORE INSERT OR UPDATE OF repeat_days,repeat_zone,repeat_anchor_at
 ON public.scheduled_messages FOR EACH ROW EXECUTE FUNCTION public.agentx_validate_status_repeat();
DROP TRIGGER IF EXISTS agentx_create_next_group_post ON public.scheduled_messages;
CREATE TRIGGER agentx_create_next_group_post AFTER UPDATE OF status ON public.scheduled_messages
 FOR EACH ROW EXECUTE FUNCTION public.agentx_create_next_status();

REVOKE ALL ON FUNCTION public.agentx_create_next_status(),public.agentx_validate_status_repeat()
 FROM PUBLIC,anon,authenticated;
COMMIT;
NOTIFY pgrst,'reload schema';
