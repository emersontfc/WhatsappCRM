BEGIN;

CREATE OR REPLACE FUNCTION public.agentx_set_whatsapp_operator_handoff(
  p_user uuid, p_contact uuid, p_phone text, p_paused boolean, p_message_id text, p_reason text DEFAULT NULL
)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  previous_pause boolean;
  changed_at timestamptz := now();
  reason text := btrim(regexp_replace(coalesce(p_reason, ''), '[[:space:][:cntrl:]]+', ' ', 'g'));
BEGIN
  IF p_user IS NULL OR p_contact IS NULL OR p_paused IS NULL
     OR p_phone IS NULL OR p_phone !~ '^[1-9][0-9]{7,14}$'
     OR public.agentx_contact_phone(p_phone) IS DISTINCT FROM p_phone
     OR p_message_id IS NULL OR length(p_message_id) NOT BETWEEN 1 AND 160
     OR btrim(p_message_id) <> p_message_id OR p_message_id ~ '[[:cntrl:]]'
     OR length(coalesce(p_reason, '')) > 200 THEN
    RAISE EXCEPTION 'Comando de atendimento inválido' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.whatsapp_operator_commands AS command
    WHERE command.user_id = p_user AND command.message_id = p_message_id
  ) THEN
    RAISE EXCEPTION 'Comando de atendimento indisponível' USING ERRCODE = '22023';
  END IF;

  SELECT contact.ai_paused INTO previous_pause
  FROM public.contacts AS contact
  WHERE contact.user_id = p_user AND contact.id = p_contact AND contact.phone = p_phone
    AND p_phone <> regexp_replace(coalesce(contact.lid, ''), '[:@].*$', '')
  FOR UPDATE;

  IF NOT FOUND THEN RETURN 'missing'; END IF;
  IF coalesce(previous_pause, false) = p_paused THEN RETURN 'already'; END IF;

  UPDATE public.contacts
  SET ai_paused = p_paused, ai_paused_at = CASE WHEN p_paused THEN changed_at END
  WHERE id = p_contact AND user_id = p_user;

  INSERT INTO public.agent_logs (user_id, phone, action, data, created_at)
  VALUES (p_user, p_phone, CASE WHEN p_paused THEN 'pause_ai_conversation' ELSE 'resume_ai_conversation' END,
    jsonb_build_object(
      'source', 'whatsapp_operator',
      'contactId', p_contact,
      'messageId', p_message_id,
      'reason', coalesce(nullif(reason, ''), CASE WHEN p_paused THEN
        'Atendimento humano solicitado pelo proprietário.' ELSE 'IA retomada pelo proprietário.' END)
    ), changed_at);

  RETURN 'changed';
END;
$$;

REVOKE ALL ON FUNCTION public.agentx_set_whatsapp_operator_handoff(uuid,uuid,text,boolean,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agentx_set_whatsapp_operator_handoff(uuid,uuid,text,boolean,text,text) TO service_role;
GRANT SELECT, UPDATE ON public.contacts TO service_role;
GRANT SELECT, INSERT ON public.whatsapp_operator_commands TO service_role;
GRANT INSERT ON public.agent_logs TO service_role;

CREATE OR REPLACE FUNCTION public.agentx_whatsapp_operator_audit_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT to_regprocedure('public.agentx_set_whatsapp_operator_handoff(uuid,uuid,text,boolean,text,text)') IS NOT NULL
    AND to_regprocedure('public.agentx_contact_phone(text)') IS NOT NULL
    AND to_regclass('public.whatsapp_operator_commands') IS NOT NULL
    AND has_function_privilege('service_role',
      to_regprocedure('public.agentx_set_whatsapp_operator_handoff(uuid,uuid,text,boolean,text,text)'), 'EXECUTE')
    AND NOT has_function_privilege('anon',
      to_regprocedure('public.agentx_set_whatsapp_operator_handoff(uuid,uuid,text,boolean,text,text)'), 'EXECUTE')
    AND NOT has_function_privilege('authenticated',
      to_regprocedure('public.agentx_set_whatsapp_operator_handoff(uuid,uuid,text,boolean,text,text)'), 'EXECUTE')
    AND has_table_privilege('service_role', to_regclass('public.contacts'), 'SELECT')
    AND has_table_privilege('service_role', to_regclass('public.contacts'), 'UPDATE')
    AND has_table_privilege('service_role', to_regclass('public.whatsapp_operator_commands'), 'SELECT')
    AND has_table_privilege('service_role', to_regclass('public.whatsapp_operator_commands'), 'INSERT')
    AND has_table_privilege('service_role', to_regclass('public.agent_logs'), 'INSERT')
    AND NOT EXISTS (
      SELECT 1 FROM (VALUES ('public.contacts', 'ai_paused'), ('public.contacts', 'ai_paused_at'),
        ('public.contacts', 'lid'), ('public.agent_logs', 'data')) AS required(relation, column_name)
      WHERE NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute AS attribute
        WHERE attribute.attrelid = to_regclass(required.relation)
          AND attribute.attname = required.column_name AND attribute.attnum > 0 AND NOT attribute.attisdropped
      )
    );
$$;

REVOKE ALL ON FUNCTION public.agentx_whatsapp_operator_audit_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agentx_whatsapp_operator_audit_ready() TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
