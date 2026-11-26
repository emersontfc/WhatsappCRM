BEGIN;

ALTER TABLE public.group_rules
  ADD COLUMN IF NOT EXISTS allowed_link_hosts text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS blocked_words text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS warning_limit integer NOT NULL DEFAULT 0;
ALTER TABLE public.group_rules DROP CONSTRAINT IF EXISTS agentx_group_rules_warning_limit;
ALTER TABLE public.group_rules ADD CONSTRAINT agentx_group_rules_warning_limit
  CHECK (warning_limit BETWEEN 0 AND 10) NOT VALID;

ALTER TABLE public.agentx_group_events DROP CONSTRAINT IF EXISTS agentx_group_events_rule_check;
ALTER TABLE public.agentx_group_events ADD CONSTRAINT agentx_group_events_rule_check
  CHECK (rule IN ('link', 'word', 'spam', 'flood', 'welcome')) NOT VALID;
ALTER TABLE public.agentx_group_events ADD COLUMN IF NOT EXISTS source_message_id text;
ALTER TABLE public.agentx_group_events DROP CONSTRAINT IF EXISTS agentx_group_events_outcome_check;
ALTER TABLE public.agentx_group_events ADD CONSTRAINT agentx_group_events_outcome_check
  CHECK (outcome IN ('pending', 'accepted', 'no_permission', 'unverified_sender', 'failed')) NOT VALID;
CREATE UNIQUE INDEX IF NOT EXISTS agentx_group_event_source_idx
  ON public.agentx_group_events (user_id, group_jid, source_message_id);
REVOKE UPDATE ON public.agentx_group_events FROM service_role;
GRANT UPDATE (outcome) ON public.agentx_group_events TO service_role;

CREATE TABLE IF NOT EXISTS public.agentx_group_warnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  group_jid text NOT NULL CHECK (group_jid ~ '^[0-9]+(-[0-9]+)?@g[.]us$'),
  participant_jid text NOT NULL CHECK (participant_jid ~ '^[0-9]{5,20}@(s[.]whatsapp[.]net|lid)$'),
  source_message_id text NOT NULL CHECK (length(source_message_id) BETWEEN 1 AND 160),
  rule text NOT NULL CHECK (rule IN ('link', 'word', 'spam', 'flood')),
  warning_number integer NOT NULL CHECK (warning_number > 0),
  warning_limit integer NOT NULL CHECK (warning_limit BETWEEN 1 AND 10),
  status text NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'recorded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, group_jid, source_message_id)
);
CREATE INDEX IF NOT EXISTS agentx_group_warning_history_idx
  ON public.agentx_group_warnings (user_id, group_jid, created_at DESC);
CREATE INDEX IF NOT EXISTS agentx_group_warning_member_idx
  ON public.agentx_group_warnings (user_id, group_jid, participant_jid, created_at DESC);
ALTER TABLE public.agentx_group_warnings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agentx_group_warnings FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.agentx_group_warnings TO service_role;
GRANT UPDATE (status) ON public.agentx_group_warnings TO service_role;

CREATE TABLE IF NOT EXISTS public.agentx_group_hours (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  group_jid text NOT NULL CHECK (group_jid ~ '^[0-9]+(-[0-9]+)?@g[.]us$'),
  enabled boolean NOT NULL,
  timezone text NOT NULL,
  days smallint[] NOT NULL CHECK (cardinality(days) BETWEEN 1 AND 7 AND days <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
  opens_at time NOT NULL,
  closes_at time NOT NULL CHECK (closes_at <> opens_at),
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_outcome text CHECK (last_outcome IN ('confirmed', 'retry', 'no_permission', 'failed')),
  claim_token uuid,
  lease_until timestamptz,
  claim_boundary_at timestamptz,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count BETWEEN 0 AND 3),
  PRIMARY KEY (user_id, group_jid)
);
CREATE INDEX IF NOT EXISTS agentx_group_hours_due_idx ON public.agentx_group_hours (next_run_at) WHERE enabled;
ALTER TABLE public.agentx_group_hours ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agentx_group_hours FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.agentx_group_hours TO service_role;

CREATE OR REPLACE FUNCTION public.agentx_set_group_policy(
  p_user uuid, p_group text, p_rules jsonb, p_schedule jsonb
) RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  hosts text[];
  words text[];
  warn_limit integer;
  existing public.agentx_group_hours%ROWTYPE;
  schedule_enabled boolean;
  schedule_timezone text;
  schedule_days smallint[];
  schedule_opens time;
  schedule_closes time;
  now_at timestamptz := clock_timestamp();
BEGIN
  IF p_user IS NULL OR p_group IS NULL OR p_group !~ '^[0-9]+(-[0-9]+)?@g[.]us$'
     OR jsonb_typeof(p_rules) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_rules->'allowed_link_hosts') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_rules->'blocked_words') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_rules->'warning_limit') IS DISTINCT FROM 'number'
     OR p_rules->>'warning_limit' !~ '^([0-9]|10)$' THEN
    RAISE EXCEPTION 'Regras do grupo inválidas' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_rules->'allowed_link_hosts') > 20 OR jsonb_array_length(p_rules->'blocked_words') > 20
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_rules->'allowed_link_hosts') AS item(value)
       WHERE jsonb_typeof(value) <> 'string' OR length(value #>> '{}') > 253
       OR value #>> '{}' !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?[.])+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_rules->'blocked_words') AS item(value)
       WHERE jsonb_typeof(value) <> 'string' OR length(btrim(value #>> '{}')) NOT BETWEEN 1 AND 64
       OR value #>> '{}' ~ '[[:cntrl:]]') THEN
    RAISE EXCEPTION 'Domínios ou palavras inválidos' USING ERRCODE = '22023';
  END IF;
  hosts := ARRAY(SELECT DISTINCT value FROM jsonb_array_elements_text(p_rules->'allowed_link_hosts') AS item(value) ORDER BY value);
  words := ARRAY(SELECT DISTINCT btrim(value) FROM jsonb_array_elements_text(p_rules->'blocked_words') AS item(value) ORDER BY btrim(value));
  warn_limit := (p_rules->>'warning_limit')::integer;

  schedule_enabled := false;
  IF p_schedule IS NOT NULL AND p_schedule <> 'null'::jsonb THEN
    IF jsonb_typeof(p_schedule) IS DISTINCT FROM 'object'
       OR jsonb_typeof(p_schedule->'enabled') IS DISTINCT FROM 'boolean'
       OR jsonb_typeof(p_schedule->'days') IS DISTINCT FROM 'array'
       OR COALESCE(p_schedule->>'opens_at', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:00)?$'
       OR COALESCE(p_schedule->>'closes_at', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:00)?$'
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p_schedule->>'timezone') THEN
      RAISE EXCEPTION 'Horário do grupo inválido' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(p_schedule->'days') NOT BETWEEN 1 AND 7 OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_schedule->'days') AS item(value)
      WHERE jsonb_typeof(value) <> 'number' OR value::text !~ '^[1-7]$'
    ) THEN
      RAISE EXCEPTION 'Dias do horário inválidos' USING ERRCODE = '22023';
    END IF;
    schedule_timezone := p_schedule->>'timezone';
    schedule_enabled := (p_schedule->>'enabled')::boolean;
    schedule_days := ARRAY(SELECT DISTINCT value::smallint FROM jsonb_array_elements_text(p_schedule->'days') AS item(value) ORDER BY value::smallint);
    schedule_opens := (p_schedule->>'opens_at')::time;
    schedule_closes := (p_schedule->>'closes_at')::time;
    IF schedule_closes = schedule_opens OR cardinality(schedule_days) <> jsonb_array_length(p_schedule->'days') THEN
      RAISE EXCEPTION 'O horário precisa de dias distintos e de horas diferentes para abrir e fechar' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Serialize policy updates per group without contending with other groups.
  INSERT INTO public.group_rules (user_id, group_jid, allowed_link_hosts, blocked_words, warning_limit)
  VALUES (p_user, p_group, hosts, words, warn_limit)
  ON CONFLICT (user_id, group_jid) DO UPDATE SET allowed_link_hosts = EXCLUDED.allowed_link_hosts,
    blocked_words = EXCLUDED.blocked_words, warning_limit = EXCLUDED.warning_limit, updated_at = now_at;

  SELECT * INTO existing FROM public.agentx_group_hours
    WHERE user_id = p_user AND group_jid = p_group FOR UPDATE;
  IF schedule_timezone IS NULL THEN
    IF NOT FOUND OR NOT existing.enabled THEN RETURN; END IF;
    schedule_timezone := existing.timezone;
    schedule_days := existing.days;
    schedule_opens := existing.opens_at;
    schedule_closes := existing.closes_at;
  END IF;
  IF ROW(existing.enabled, existing.timezone, existing.days, existing.opens_at, existing.closes_at)
     IS NOT DISTINCT FROM ROW(schedule_enabled, schedule_timezone, schedule_days, schedule_opens, schedule_closes) THEN
    RETURN;
  END IF;
  IF existing.lease_until > clock_timestamp() THEN
    RAISE EXCEPTION 'O horário está em execução' USING ERRCODE = '55P03';
  END IF;

  INSERT INTO public.agentx_group_hours (user_id, group_jid, enabled, timezone, days, opens_at, closes_at, next_run_at)
  VALUES (p_user, p_group, schedule_enabled, schedule_timezone, schedule_days, schedule_opens, schedule_closes,
    CASE WHEN schedule_enabled THEN clock_timestamp() END)
  ON CONFLICT (user_id, group_jid) DO UPDATE SET enabled = EXCLUDED.enabled, timezone = EXCLUDED.timezone,
    days = EXCLUDED.days, opens_at = EXCLUDED.opens_at, closes_at = EXCLUDED.closes_at, next_run_at = EXCLUDED.next_run_at,
    claim_token = NULL, lease_until = NULL, claim_boundary_at = NULL, retry_count = 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_claim_group_warning(
  p_user uuid, p_group text, p_member text, p_message text, p_rule text
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  limit_for_group integer;
  number_for_member integer;
  warning public.agentx_group_warnings%ROWTYPE;
  evaluated_at timestamptz;
BEGIN
  IF p_user IS NULL OR p_group IS NULL OR p_group !~ '^[0-9]+(-[0-9]+)?@g[.]us$'
     OR p_member IS NULL OR p_member !~ '^[0-9]{5,20}@(s[.]whatsapp[.]net|lid)$'
     OR p_message IS NULL OR length(p_message) NOT BETWEEN 1 AND 160
     OR p_rule IS NULL OR p_rule NOT IN ('link', 'word', 'spam', 'flood') THEN
    RAISE EXCEPTION 'Aviso do grupo inválido' USING ERRCODE = '22023';
  END IF;

  SELECT warning_limit INTO limit_for_group FROM public.group_rules
    WHERE user_id = p_user AND group_jid = p_group AND active AND warning_limit > 0 FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('agentx.group.warning:' || p_user || ':' || p_group || ':' || p_member, 0));
  IF EXISTS (SELECT 1 FROM public.agentx_group_warnings
    WHERE user_id = p_user AND group_jid = p_group AND source_message_id = p_message) THEN RETURN NULL; END IF;

  evaluated_at := clock_timestamp();
  SELECT count(*) + 1 INTO number_for_member FROM public.agentx_group_warnings
    WHERE user_id = p_user AND group_jid = p_group AND participant_jid = p_member
      AND created_at >= evaluated_at - interval '24 hours';

  INSERT INTO public.agentx_group_warnings (
    user_id, group_jid, participant_jid, source_message_id, rule, warning_number, warning_limit, status, created_at
  ) VALUES (p_user, p_group, p_member, p_message, p_rule, number_for_member, limit_for_group,
    CASE WHEN number_for_member <= limit_for_group THEN 'pending' ELSE 'recorded' END, evaluated_at)
  ON CONFLICT (user_id, group_jid, source_message_id) DO NOTHING RETURNING * INTO warning;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('id', warning.id, 'warning_number', warning.warning_number,
    'warning_limit', warning.warning_limit, 'status', warning.status);
END;
$$;

-- A late worker applies the latest boundary once, even if it missed several transitions.
CREATE OR REPLACE FUNCTION public.agentx_group_hours_window(
  p_timezone text, p_days smallint[], p_opens time, p_closes time, p_now timestamptz
) RETURNS TABLE (announce boolean, boundary_at timestamptz)
LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH local_dates AS (
    SELECT (p_now AT TIME ZONE p_timezone)::date + delta AS day
    FROM generate_series(-8, 8) AS offset_days(delta)
  ), periods AS (
    SELECT (day + p_opens) AT TIME ZONE p_timezone AS opening,
      (day + (p_closes < p_opens)::integer + p_closes) AT TIME ZONE p_timezone AS closing
    FROM local_dates WHERE extract(isodow FROM day)::smallint = ANY(p_days)
  ), boundaries AS (
    SELECT opening AS boundary, false AS closed FROM periods WHERE opening < closing
    UNION ALL
    SELECT closing, true FROM periods WHERE opening < closing
  )
  SELECT COALESCE((SELECT closed FROM boundaries WHERE boundary <= p_now ORDER BY boundary DESC, closed DESC LIMIT 1), true),
    (SELECT min(boundary) FROM boundaries WHERE boundary > p_now);
$$;

CREATE OR REPLACE FUNCTION public.agentx_claim_group_hours(p_now timestamptz)
RETURNS TABLE (user_id uuid, group_jid text, claim_token uuid, announce boolean)
LANGUAGE sql SET search_path = '' AS $$
  WITH due AS (
    SELECT h.user_id, h.group_jid, h.timezone, h.days, h.opens_at, h.closes_at
    FROM public.agentx_group_hours AS h
    WHERE h.enabled AND h.next_run_at <= p_now AND (h.lease_until IS NULL OR h.lease_until <= p_now)
    ORDER BY h.next_run_at, h.user_id, h.group_jid LIMIT 8 FOR UPDATE SKIP LOCKED
  )
  UPDATE public.agentx_group_hours AS h
    SET claim_token = gen_random_uuid(), lease_until = p_now + interval '2 minutes', claim_boundary_at = target.boundary_at
  FROM due CROSS JOIN LATERAL public.agentx_group_hours_window(due.timezone, due.days, due.opens_at, due.closes_at, p_now) AS target
  WHERE h.user_id = due.user_id AND h.group_jid = due.group_jid
  RETURNING h.user_id, h.group_jid, h.claim_token, target.announce;
$$;

CREATE OR REPLACE FUNCTION public.agentx_finish_group_hours(
  p_user uuid, p_group text, p_claim uuid, p_outcome text, p_now timestamptz
) RETURNS boolean LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  claimed public.agentx_group_hours%ROWTYPE;
  upcoming timestamptz;
  postponement interval;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('confirmed', 'retry', 'no_permission', 'failed') OR p_now IS NULL THEN
    RAISE EXCEPTION 'Resultado de horário inválido' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO claimed FROM public.agentx_group_hours
    WHERE user_id = p_user AND group_jid = p_group AND enabled AND claim_token = p_claim FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT boundary_at INTO upcoming FROM public.agentx_group_hours_window(claimed.timezone, claimed.days, claimed.opens_at, claimed.closes_at, p_now);
  IF claimed.claim_boundary_at <= p_now THEN
    upcoming := p_now;
  ELSIF p_outcome = 'retry' THEN
    postponement := make_interval(mins => (ARRAY[3, 6, 12, 15])[claimed.retry_count + 1]);
    upcoming := LEAST(upcoming, p_now + postponement);
  END IF;
  UPDATE public.agentx_group_hours SET claim_token = NULL, lease_until = NULL, claim_boundary_at = NULL,
    last_run_at = p_now, last_outcome = p_outcome, next_run_at = upcoming,
    retry_count = CASE WHEN p_outcome = 'retry' AND upcoming > p_now THEN LEAST(retry_count + 1, 3) ELSE 0 END
  WHERE user_id = p_user AND group_jid = p_group;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_group_policy_ready() RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT to_regclass('public.agentx_group_hours_due_idx') IS NOT NULL
    AND to_regclass('public.agentx_group_warning_history_idx') IS NOT NULL
    AND to_regclass('public.agentx_group_event_source_idx') IS NOT NULL
    AND to_regprocedure('public.agentx_set_group_policy(uuid,text,jsonb,jsonb)') IS NOT NULL
    AND to_regprocedure('public.agentx_claim_group_warning(uuid,text,text,text,text)') IS NOT NULL
    AND to_regprocedure('public.agentx_claim_group_hours(timestamptz)') IS NOT NULL
    AND to_regprocedure('public.agentx_finish_group_hours(uuid,text,uuid,text,timestamptz)') IS NOT NULL
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid = to_regclass('public.agentx_group_warnings') AND relrowsecurity)
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid = to_regclass('public.agentx_group_hours') AND relrowsecurity);
$$;

REVOKE ALL ON FUNCTION public.agentx_set_group_policy(uuid,text,jsonb,jsonb),
  public.agentx_claim_group_warning(uuid,text,text,text,text), public.agentx_group_hours_window(text,smallint[],time,time,timestamptz),
  public.agentx_claim_group_hours(timestamptz), public.agentx_finish_group_hours(uuid,text,uuid,text,timestamptz),
  public.agentx_group_policy_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agentx_set_group_policy(uuid,text,jsonb,jsonb),
  public.agentx_claim_group_warning(uuid,text,text,text,text), public.agentx_group_hours_window(text,smallint[],time,time,timestamptz),
  public.agentx_claim_group_hours(timestamptz), public.agentx_finish_group_hours(uuid,text,uuid,text,timestamptz),
  public.agentx_group_policy_ready() TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
