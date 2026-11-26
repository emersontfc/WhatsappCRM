BEGIN;

CREATE OR REPLACE FUNCTION public.agentx_valid_group_moderation_rules(value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN jsonb_typeof(value) IS DISTINCT FROM 'object' THEN false ELSE NOT EXISTS (
    SELECT 1 FROM jsonb_each(value) AS rule(name, action)
    WHERE rule.name NOT IN ('link','word','spam','flood','image','video','audio','voice','document','sticker','gif','poll','contact','location','reaction','invite','event')
      OR rule.action NOT IN ('"allow"'::jsonb,'"warn"'::jsonb,'"delete"'::jsonb,'"review"'::jsonb)
  ) END
$$;

ALTER TABLE public.group_rules
  ADD COLUMN IF NOT EXISTS moderation_actions jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (public.agentx_valid_group_moderation_rules(moderation_actions)),
  ADD COLUMN IF NOT EXISTS moderation_warning text CHECK (length(moderation_warning) BETWEEN 1 AND 600),
  ADD COLUMN IF NOT EXISTS catalog_sales_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.agentx_group_events
  ADD COLUMN IF NOT EXISTS action text CHECK (action IN ('warn','delete','review')),
  ADD COLUMN IF NOT EXISTS participant_jid text CHECK (participant_jid ~ '^[0-9]{5,20}@(s[.]whatsapp[.]net|lid)$'),
  ADD COLUMN IF NOT EXISTS review_status text CHECK (review_status IN ('pending','reviewed','dismissed')),
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

ALTER TABLE public.agentx_group_events DROP CONSTRAINT IF EXISTS agentx_group_events_rule_check;
ALTER TABLE public.agentx_group_events ADD CONSTRAINT agentx_group_events_rule_check
  CHECK (rule IN ('link','word','spam','flood','image','video','audio','voice','document','sticker','gif','poll','contact','location','reaction','invite','event','welcome')) NOT VALID;
ALTER TABLE public.agentx_group_events DROP CONSTRAINT IF EXISTS agentx_group_events_outcome_check;
ALTER TABLE public.agentx_group_events ADD CONSTRAINT agentx_group_events_outcome_check
  CHECK (outcome IN ('pending','accepted','no_permission','unverified_sender','failed','queued_review','recorded','uncertain')) NOT VALID;
ALTER TABLE public.agentx_group_warnings DROP CONSTRAINT IF EXISTS agentx_group_warnings_rule_check;
ALTER TABLE public.agentx_group_warnings ADD CONSTRAINT agentx_group_warnings_rule_check
  CHECK (rule IN ('link','word','spam','flood','image','video','audio','voice','document','sticker','gif','poll','contact','location','reaction','invite','event')) NOT VALID;

CREATE INDEX IF NOT EXISTS agentx_group_moderation_pending_idx
  ON public.agentx_group_events (user_id,group_jid,id DESC) WHERE review_status = 'pending';
GRANT UPDATE (outcome,review_status,reviewed_at) ON public.agentx_group_events TO service_role;

CREATE OR REPLACE FUNCTION public.agentx_claim_group_moderation(
  p_user uuid, p_group text, p_member text, p_message text, p_rule text
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  settings public.group_rules%ROWTYPE;
  selected_action text;
  event_id bigint;
  warning public.agentx_group_warnings%ROWTYPE;
  warning_count integer;
  daily_limit integer;
  evaluated_at timestamptz;
BEGIN
  IF p_user IS NULL OR p_group IS NULL OR p_group !~ '^[0-9]+(-[0-9]+)?@g[.]us$'
    OR p_member IS NULL OR p_member !~ '^[0-9]{5,20}@(s[.]whatsapp[.]net|lid)$'
    OR p_message IS NULL OR length(p_message) NOT BETWEEN 1 AND 160
    OR p_rule IS NULL OR NOT public.agentx_valid_group_moderation_rules(jsonb_build_object(p_rule,'review')) THEN
    RAISE EXCEPTION 'Ocorrência de moderação inválida' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO settings FROM public.group_rules
    WHERE user_id=p_user AND group_jid=p_group AND active FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF (p_rule='link' AND NOT settings.anti_link) OR (p_rule='spam' AND NOT settings.anti_spam)
    OR (p_rule='flood' AND NOT settings.anti_flood)
    OR (p_rule='word' AND COALESCE(cardinality(settings.blocked_words),0)=0) THEN
    RETURN NULL;
  END IF;
  selected_action := COALESCE(settings.moderation_actions->>p_rule, CASE
    WHEN p_rule IN ('link','word','spam','flood') AND settings.warning_limit>0 THEN 'warn'
    WHEN p_rule IN ('link','word','spam','flood') THEN 'delete' ELSE 'allow' END);
  IF selected_action='allow' OR EXISTS (SELECT 1 FROM public.agentx_group_warnings
    WHERE user_id=p_user AND group_jid=p_group AND source_message_id=p_message) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.agentx_group_events (user_id,group_jid,source_message_id,participant_jid,rule,action,outcome,review_status)
  VALUES (p_user,p_group,p_message,p_member,p_rule,selected_action,
    CASE WHEN selected_action='review' THEN 'queued_review' ELSE 'pending' END,
    CASE WHEN selected_action='review' THEN 'pending' END)
  ON CONFLICT (user_id,group_jid,source_message_id) DO NOTHING RETURNING id INTO event_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF selected_action <> 'warn' THEN RETURN jsonb_build_object('id',event_id,'action',selected_action); END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('agentx.group.warning:' || p_user || ':' || p_group || ':' || p_member,0));
  evaluated_at := clock_timestamp();
  daily_limit := COALESCE(NULLIF(settings.warning_limit,0),3);
  SELECT count(*) + 1 INTO warning_count FROM (
    SELECT 1 FROM public.agentx_group_warnings
      WHERE user_id=p_user AND group_jid=p_group AND participant_jid=p_member AND created_at >= evaluated_at - interval '24 hours'
      LIMIT daily_limit
  ) AS previous_warnings;
  IF warning_count > daily_limit THEN
    UPDATE public.agentx_group_events SET outcome='recorded' WHERE id=event_id;
    RETURN NULL;
  END IF;
  INSERT INTO public.agentx_group_warnings (user_id,group_jid,participant_jid,source_message_id,rule,warning_number,warning_limit,status,created_at)
  VALUES (p_user,p_group,p_member,p_message,p_rule,warning_count,daily_limit,'pending',evaluated_at)
  ON CONFLICT (user_id,group_jid,source_message_id) DO NOTHING RETURNING * INTO warning;
  IF NOT FOUND THEN
    UPDATE public.agentx_group_events SET outcome='recorded' WHERE id=event_id;
    RETURN NULL;
  END IF;
  IF warning_count = daily_limit THEN
    UPDATE public.agentx_group_events SET review_status='pending' WHERE id=event_id;
  END IF;
  RETURN jsonb_build_object('id',event_id,'action',selected_action,'warningId',warning.id,
    'warningNumber',warning_count,'warningLimit',daily_limit,'template',settings.moderation_warning);
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_group_moderation_ready()
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT to_regprocedure('public.agentx_claim_group_moderation(uuid,text,text,text,text)') IS NOT NULL
    AND to_regclass('public.agentx_group_moderation_pending_idx') IS NOT NULL
    AND (SELECT count(*) FROM pg_catalog.pg_attribute WHERE attrelid='public.group_rules'::regclass
      AND attname IN ('moderation_actions','moderation_warning','catalog_sales_enabled') AND NOT attisdropped)=3
    AND (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='public.agentx_group_events'::regclass)
$$;

REVOKE ALL ON FUNCTION public.agentx_valid_group_moderation_rules(jsonb),
  public.agentx_claim_group_moderation(uuid,text,text,text,text), public.agentx_group_moderation_ready()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agentx_valid_group_moderation_rules(jsonb),
  public.agentx_claim_group_moderation(uuid,text,text,text,text), public.agentx_group_moderation_ready()
  TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
