BEGIN;

CREATE OR REPLACE FUNCTION public.agentx_contact_phone(value text)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = '' AS $$
DECLARE
  raw text := regexp_replace(value, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  phone text;
BEGIN
  IF raw ~* '^[0-9]{8,15}(:[0-9]+)?@(s[.]whatsapp[.]net|c[.]us)$' THEN
    phone := split_part(split_part(raw, '@', 1), ':', 1);
  ELSIF raw ~ '^[+]?[0-9[:space:]().-]+$' THEN
    phone := regexp_replace(raw, '[^0-9]', '', 'g');
    IF phone LIKE '00%' THEN phone := substr(phone, 3); END IF;
  ELSE
    RETURN NULL;
  END IF;
  IF phone ~ '^0?8[2-7][0-9]{7}$' THEN phone := '258' || regexp_replace(phone, '^0', ''); END IF;
  IF phone ~ '^25808[2-7][0-9]{7}$' THEN phone := '258' || substr(phone, 5); END IF;
  IF phone ~ '^[1-9][0-9]{7,14}$' THEN RETURN phone; END IF;
  RETURN NULL;
END;
$$;

-- Retain historical duplicate rows and their references. Reserve each phone for one contact.
ALTER TABLE public.contacts ALTER COLUMN phone DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS agentx_legacy_phone_duplicate boolean NOT NULL DEFAULT false;
DROP TRIGGER IF EXISTS agentx_guard_contact_phone ON public.contacts;
DROP INDEX IF EXISTS public.agentx_contact_unique_canonical_phone;

WITH ranked AS (
  SELECT c.id, row_number() OVER (
    PARTITION BY c.user_id, normalized.phone
    ORDER BY (c.phone = normalized.phone) DESC, c.created_at NULLS LAST, c.id
  ) AS position
  FROM public.contacts c
  CROSS JOIN LATERAL (SELECT public.agentx_contact_phone(c.phone) AS phone) normalized
  WHERE NOT c.agentx_legacy_phone_duplicate AND normalized.phone IS NOT NULL
    AND normalized.phone IS DISTINCT FROM NULLIF(regexp_replace(c.lid, '[:@].*$', ''), '')
)
UPDATE public.contacts c SET agentx_legacy_phone_duplicate = true
FROM ranked
WHERE c.id = ranked.id AND ranked.position > 1;

CREATE INDEX IF NOT EXISTS agentx_contact_phone_lookup ON public.contacts (user_id, public.agentx_contact_phone(phone));
CREATE UNIQUE INDEX agentx_contact_unique_canonical_phone ON public.contacts (user_id, public.agentx_contact_phone(phone))
  WHERE NOT agentx_legacy_phone_duplicate
    AND public.agentx_contact_phone(phone) IS NOT NULL
    AND public.agentx_contact_phone(phone) IS DISTINCT FROM NULLIF(regexp_replace(lid, '[:@].*$', ''), '');

CREATE OR REPLACE FUNCTION public.agentx_guard_contact_phone()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  canonical text := public.agentx_contact_phone(NEW.phone);
  new_lid text := regexp_replace(COALESCE(NEW.lid, ''), '[:@].*$', '');
  old_lid text;
BEGIN
  -- The migration marks historical duplicates. Writes cannot claim that exception for a new identity.
  NEW.agentx_legacy_phone_duplicate := false;
  IF TG_OP = 'UPDATE' THEN
    old_lid := regexp_replace(COALESCE(OLD.lid, ''), '[:@].*$', '');
    IF OLD.user_id = NEW.user_id AND OLD.phone IS NOT DISTINCT FROM NEW.phone
      AND (canonical = old_lid) IS NOT DISTINCT FROM (canonical = new_lid) THEN
      NEW.agentx_legacy_phone_duplicate := OLD.agentx_legacy_phone_duplicate;
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.phone IS NULL OR btrim(NEW.phone) = '' THEN
    NEW.phone := NULL;
    RETURN NEW;
  END IF;
  IF canonical IS NULL OR canonical = new_lid THEN
    RAISE EXCEPTION 'Introduce um número de telefone válido' USING ERRCODE = '22023';
  END IF;
  NEW.phone := canonical;
  -- Serialise by account so a legacy variant and a canonical insert cannot race.
  PERFORM pg_advisory_xact_lock(hashtextextended('agentx-contact:' || NEW.user_id::text, 0));
  IF TG_OP = 'UPDATE' AND OLD.user_id = NEW.user_id AND public.agentx_contact_phone(OLD.phone) = canonical AND canonical <> old_lid THEN
    NEW.agentx_legacy_phone_duplicate := OLD.agentx_legacy_phone_duplicate;
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.user_id = NEW.user_id AND c.id IS DISTINCT FROM NEW.id AND public.agentx_contact_phone(c.phone) = canonical
      AND canonical <> regexp_replace(COALESCE(c.lid, ''), '[:@].*$', '')
  ) THEN
    RAISE EXCEPTION 'O número já está registado nesta conta' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agentx_guard_contact_phone BEFORE INSERT OR UPDATE OF phone, user_id, lid, agentx_legacy_phone_duplicate ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.agentx_guard_contact_phone();

CREATE OR REPLACE FUNCTION public.agentx_save_contact(
  p_user_id uuid, p_phone text, p_name text, p_lid text DEFAULT NULL, p_tags text[] DEFAULT '{}',
  p_replace_name boolean DEFAULT false, p_existing_only boolean DEFAULT false, p_max_contacts integer DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  phone_number text := public.agentx_contact_phone(p_phone);
  contact_lid text := NULLIF(regexp_replace(COALESCE(p_lid, ''), '[:@].*$', ''), '');
  display_name text := NULLIF(btrim(p_name), '');
  saved public.contacts%ROWTYPE;
  stored_phone text;
BEGIN
  IF p_user_id IS NULL OR (contact_lid IS NOT NULL AND contact_lid !~ '^[0-9]{5,20}$')
    OR (phone_number IS NULL AND contact_lid IS NULL) OR phone_number = contact_lid THEN
    RAISE EXCEPTION 'Telefone ou identidade inválida' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('agentx-contact:' || p_user_id::text, 0));

  IF phone_number IS NOT NULL THEN
    SELECT * INTO saved FROM public.contacts c
    WHERE c.user_id = p_user_id AND public.agentx_contact_phone(c.phone) = phone_number
      AND phone_number <> regexp_replace(COALESCE(c.lid, ''), '[:@].*$', '')
    ORDER BY c.agentx_legacy_phone_duplicate, (c.phone = phone_number) DESC, c.created_at NULLS LAST, c.id LIMIT 1;
  END IF;
  IF saved.id IS NULL AND contact_lid IS NOT NULL THEN
    SELECT * INTO saved FROM public.contacts c
    WHERE c.user_id = p_user_id AND (
      regexp_replace(c.lid, '[:@].*$', '') = contact_lid
      OR (NULLIF(c.lid, '') IS NULL AND c.phone IN (contact_lid, contact_lid || '@lid'))
    )
    ORDER BY (public.agentx_contact_phone(c.phone) IS NOT NULL AND c.phone <> contact_lid) DESC,
      c.created_at NULLS LAST, c.id LIMIT 1;
  END IF;

  IF saved.id IS NOT NULL THEN
    stored_phone := public.agentx_contact_phone(saved.phone);
    IF phone_number IS NOT NULL AND saved.phone IS DISTINCT FROM phone_number
      AND (stored_phone IS NULL OR stored_phone = phone_number OR stored_phone = contact_lid) THEN
      UPDATE public.contacts SET phone = phone_number WHERE id = saved.id AND user_id = p_user_id;
    ELSIF phone_number IS NULL AND contact_lid IS NOT NULL AND saved.phone IN (contact_lid, contact_lid || '@lid') THEN
      UPDATE public.contacts SET phone = NULL WHERE id = saved.id AND user_id = p_user_id;
    END IF;
    UPDATE public.contacts c
    SET lid = COALESCE(NULLIF(c.lid, ''), contact_lid),
        name = CASE WHEN display_name IS NOT NULL AND
          (p_replace_name OR btrim(COALESCE(c.name,'')) IN ('','Contacto WhatsApp','Sem Nome')
            OR c.name ~ '^[0-9[:space:]+()-]+$') THEN display_name ELSE c.name END,
        tags = ARRAY(SELECT DISTINCT tag FROM unnest(COALESCE(c.tags, '{}') || COALESCE(p_tags, '{}')) AS tag ORDER BY tag)
    WHERE c.id = saved.id AND c.user_id = p_user_id
    RETURNING * INTO saved;
    RETURN jsonb_build_object('id', saved.id, 'phone', saved.phone, 'name', saved.name, 'created', false);
  END IF;
  IF p_existing_only THEN RETURN NULL; END IF;
  IF p_max_contacts IS NOT NULL AND (SELECT count(*) FROM public.contacts WHERE user_id = p_user_id) >= p_max_contacts THEN
    RETURN jsonb_build_object('limited', true);
  END IF;

  INSERT INTO public.contacts(user_id, phone, lid, name, tags)
  VALUES (p_user_id, phone_number, contact_lid, COALESCE(display_name, phone_number, 'Contacto WhatsApp'), COALESCE(p_tags, '{}'))
  RETURNING * INTO saved;
  RETURN jsonb_build_object('id', saved.id, 'phone', saved.phone, 'name', saved.name, 'created', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_import_contacts(p_user_id uuid, p_contacts jsonb, p_max_contacts integer)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  item jsonb;
  saved jsonb;
  created integer := 0;
  updated integer := 0;
  limited integer := 0;
BEGIN
  FOR item IN SELECT value FROM jsonb_array_elements(p_contacts) LOOP
    saved := public.agentx_save_contact(p_user_id, item->>'phone', item->>'name', p_tags => ARRAY['Importado'],
      p_replace_name => true, p_max_contacts => p_max_contacts);
    IF (saved->>'limited')::boolean THEN limited := limited + 1;
    ELSIF (saved->>'created')::boolean THEN created := created + 1;
    ELSE updated := updated + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('created', created, 'updated', updated, 'limited', limited);
END;
$$;

REVOKE ALL ON FUNCTION public.agentx_save_contact(uuid,text,text,text,text[],boolean,boolean,integer),
  public.agentx_import_contacts(uuid,jsonb,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agentx_save_contact(uuid,text,text,text,text[],boolean,boolean,integer),
  public.agentx_import_contacts(uuid,jsonb,integer) TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
