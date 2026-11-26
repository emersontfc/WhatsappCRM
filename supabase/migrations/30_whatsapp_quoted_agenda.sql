BEGIN;

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS reply_to_message_id uuid;
ALTER TABLE public.scheduled_messages ADD COLUMN IF NOT EXISTS reply_to_message_id uuid;

-- A schedule retains the reference even after a deletion so the worker can stop
-- explicitly instead of sending a reply without the quotation the user approved.
CREATE OR REPLACE FUNCTION public.agentx_validate_whatsapp_quote()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.reply_to_message_id IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'scheduled_messages' THEN
    IF NEW.target_type IS DISTINCT FROM 'contact' OR NEW.media_url IS NOT NULL OR NEW.media_type IS NOT NULL THEN
      RAISE check_violation USING MESSAGE = 'A resposta citada precisa de ser texto para um contacto.';
    END IF;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.messages original
    WHERE original.id = NEW.reply_to_message_id AND original.user_id = NEW.user_id AND original.contact_id = NEW.contact_id
      AND original.id <> NEW.id AND original.type IN ('inbound', 'outbound')
      AND original.msg_id ~ '^[a-zA-Z0-9_.:-]{1,160}$' AND original.msg_id NOT LIKE 'gen-%'
      AND NULLIF(btrim(original.text), '') IS NOT NULL AND original.media_url IS NULL AND original.media_type IS NULL
  ) THEN
    RAISE check_violation USING MESSAGE = 'A mensagem citada está indisponível nesta conversa.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agentx_validate_message_quote ON public.messages;
CREATE TRIGGER agentx_validate_message_quote BEFORE INSERT OR UPDATE OF reply_to_message_id, user_id, contact_id
ON public.messages FOR EACH ROW EXECUTE FUNCTION public.agentx_validate_whatsapp_quote();

DROP TRIGGER IF EXISTS agentx_validate_scheduled_quote ON public.scheduled_messages;
CREATE TRIGGER agentx_validate_scheduled_quote BEFORE INSERT OR UPDATE OF reply_to_message_id, user_id, contact_id, target_type, media_url, media_type
ON public.scheduled_messages FOR EACH ROW EXECUTE FUNCTION public.agentx_validate_whatsapp_quote();

REVOKE ALL ON FUNCTION public.agentx_validate_whatsapp_quote() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.agentx_whatsapp_quote_ready()
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM (VALUES ('public.messages', 'agentx_validate_message_quote'),
      ('public.scheduled_messages', 'agentx_validate_scheduled_quote')) AS required(relation_name, trigger_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute AS column_definition
      WHERE column_definition.attrelid = to_regclass(required.relation_name)
        AND column_definition.attname = 'reply_to_message_id' AND column_definition.atttypid = 'uuid'::regtype
        AND column_definition.attnum > 0 AND NOT column_definition.attisdropped
    ) OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger AS quote_trigger
      WHERE quote_trigger.tgrelid = to_regclass(required.relation_name) AND quote_trigger.tgname = required.trigger_name
        AND quote_trigger.tgenabled IN ('O', 'A')
        AND quote_trigger.tgfoid = to_regprocedure('public.agentx_validate_whatsapp_quote()')
    )
  );
$$;

REVOKE ALL ON FUNCTION public.agentx_whatsapp_quote_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agentx_whatsapp_quote_ready() TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
