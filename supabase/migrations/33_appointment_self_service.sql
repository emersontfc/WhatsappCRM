BEGIN;

CREATE TABLE IF NOT EXISTS public.agentx_appointment_manage_links (
  appointment_id uuid PRIMARY KEY REFERENCES public.appointments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.agentx_appointment_manage_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agentx_appointment_manage_links FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.agentx_appointment_manage_links TO service_role;

CREATE OR REPLACE FUNCTION public.agentx_revoke_appointment_manage_link() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF public.agentx_contact_phone(NEW.customer_phone) IS DISTINCT FROM public.agentx_contact_phone(OLD.customer_phone) THEN
    DELETE FROM public.agentx_appointment_manage_links WHERE appointment_id = OLD.id AND user_id = OLD.user_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS agentx_revoke_appointment_manage_link ON public.appointments;
CREATE TRIGGER agentx_revoke_appointment_manage_link AFTER UPDATE OF customer_phone ON public.appointments
  FOR EACH ROW WHEN (OLD.customer_phone IS DISTINCT FROM NEW.customer_phone)
  EXECUTE FUNCTION public.agentx_revoke_appointment_manage_link();

CREATE OR REPLACE FUNCTION public.agentx_book_public_appointment(p_user uuid, p_input jsonb, p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  saved jsonb;
  appointment uuid;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' OR nullif(p_input->>'request_id', '') IS NULL THEN
    RAISE invalid_parameter_value USING MESSAGE = 'Dados de marcação inválidos.';
  END IF;
  saved := public.agentx_save_appointment(p_user, NULL, p_input, true);
  appointment := (saved #>> '{appointment,id}')::uuid;

  -- A replay only reuses the stored capability. A removed link cannot be recreated by an old request.
  IF NOT coalesce((saved->>'replayed')::boolean, false) THEN
    INSERT INTO public.agentx_appointment_manage_links (appointment_id, user_id, token_hash)
    VALUES (appointment, p_user, p_token_hash);
  END IF;
  RETURN saved || jsonb_build_object('manageAvailable', EXISTS (
    SELECT 1 FROM public.agentx_appointment_manage_links
    WHERE appointment_id = appointment AND user_id = p_user AND token_hash = p_token_hash
  ));
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_appointment_slots_excluding(
  p_user uuid, p_service uuid, p_professional uuid, p_date date, p_exclude uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  zone text := public.agentx_appointment_timezone(p_user);
  duration integer := 30;
  hours record;
  slot timestamp;
  slots jsonb := '[]'::jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN
    RAISE no_data_found USING MESSAGE = 'Estabelecimento indisponível.';
  END IF;
  IF p_service IS NOT NULL THEN
    SELECT COALESCE(s.duration_minutes, 30) INTO duration FROM public.services s
      WHERE s.id = p_service AND s.user_id = p_user AND s.active;
    IF NOT FOUND THEN RAISE no_data_found USING MESSAGE = 'Serviço indisponível.'; END IF;
  END IF;
  IF duration NOT BETWEEN 1 AND 1440 THEN RAISE invalid_parameter_value USING MESSAGE = 'Duração do serviço inválida.'; END IF;
  SELECT * INTO hours FROM public.agentx_appointment_hours(p_user, p_professional, p_date);
  IF NOT FOUND THEN RETURN jsonb_build_object('timeZone', zone, 'durationMinutes', duration, 'slots', slots); END IF;
  FOR slot IN SELECT generate_series(
    p_date + hours.opens, p_date + hours.closes - make_interval(mins => duration), make_interval(mins => duration)
  ) LOOP
    IF (slot AT TIME ZONE zone) <= now() OR ((slot AT TIME ZONE zone) AT TIME ZONE zone) <> slot
      OR (hours.break_from IS NOT NULL AND hours.break_to IS NOT NULL
          AND slot::time < hours.break_to AND slot + make_interval(mins => duration) > p_date + hours.break_from)
      OR public.agentx_appointment_slot_conflict(p_user, p_professional, p_date, slot::time,
        CASE WHEN slot + make_interval(mins => duration) = p_date + interval '1 day' THEN '24:00'::time
          ELSE (slot + make_interval(mins => duration))::time END, p_exclude) THEN
      CONTINUE;
    END IF;
    slots := slots || jsonb_build_array(to_char(slot, 'HH24:MI'));
  END LOOP;
  RETURN jsonb_build_object('timeZone', zone, 'durationMinutes', duration, 'slots', slots);
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_available_appointment_slots(
  p_user uuid, p_service uuid, p_professional uuid, p_date date
) RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT public.agentx_appointment_slots_excluding(p_user, p_service, p_professional, p_date, NULL);
$$;

CREATE OR REPLACE FUNCTION public.agentx_public_manage_appointment(
  p_token_hash text, p_action text, p_revision uuid DEFAULT NULL, p_date date DEFAULT NULL, p_start text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  selected public.appointments%ROWTYPE;
  actor uuid;
  booking_id uuid;
  saved jsonb;
  slots jsonb;
  can_edit boolean;
  replayed boolean := false;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  IF p_action IS NULL OR p_action NOT IN ('read', 'slots', 'cancel', 'reschedule') THEN
    RAISE invalid_parameter_value USING MESSAGE = 'Operação de marcação inválida.';
  END IF;
  SELECT l.user_id, l.appointment_id INTO actor, booking_id
  FROM public.agentx_appointment_manage_links l WHERE l.token_hash = p_token_hash;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF p_action IN ('cancel', 'reschedule') THEN
    -- The same lock is used by public/internal appointment saves and deletes.
    PERFORM pg_advisory_xact_lock(hashtextextended(actor::text || ':appointments', 0));
    SELECT a.* INTO selected FROM public.appointments a
    JOIN public.agentx_appointment_manage_links l ON l.appointment_id = a.id AND l.user_id = a.user_id
    WHERE a.id = booking_id AND a.user_id = actor AND l.token_hash = p_token_hash FOR UPDATE OF a;
  ELSE
    SELECT a.* INTO selected FROM public.appointments a
    JOIN public.agentx_appointment_manage_links l ON l.appointment_id = a.id AND l.user_id = a.user_id
    WHERE a.id = booking_id AND a.user_id = actor AND l.token_hash = p_token_hash;
  END IF;
  IF NOT FOUND OR selected.start_at IS NULL OR selected.start_at < now() - interval '30 days' THEN RETURN NULL; END IF;

  can_edit := coalesce(selected.status IN ('scheduled', 'confirmed'), false) AND selected.start_at > now();
  IF p_action IN ('slots', 'reschedule') AND p_date IS NULL THEN
    RAISE invalid_parameter_value USING MESSAGE = 'Escolhe uma data válida.';
  END IF;
  IF p_action = 'reschedule' AND (p_start IS NULL OR p_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') THEN
    RAISE invalid_parameter_value USING MESSAGE = 'Escolhe um horário válido.';
  END IF;
  IF p_action <> 'read' THEN
    IF (p_action = 'cancel' AND selected.status = 'cancelled') OR
       (p_action = 'reschedule' AND can_edit AND selected.appointment_date = p_date AND selected.start_time::time = p_start::time) THEN
      replayed := true;
    ELSIF NOT can_edit THEN
      RAISE exclusion_violation USING MESSAGE = 'Esta marcação já não pode ser alterada aqui.';
    ELSIF p_action = 'slots' THEN
      RETURN public.agentx_appointment_slots_excluding(actor, selected.service_id, selected.professional_id, p_date, selected.id);
    ELSIF selected.schedule_revision IS DISTINCT FROM p_revision THEN
      RAISE exclusion_violation USING MESSAGE = 'A marcação foi atualizada. Confere os dados antes de continuar.';
    ELSIF p_action = 'cancel' THEN
      saved := public.agentx_save_appointment(actor, selected.id, '{"status":"cancelled"}'::jsonb, false);
    ELSE
      slots := public.agentx_appointment_slots_excluding(actor, selected.service_id, selected.professional_id, p_date, selected.id);
      IF NOT ((slots->'slots') ? p_start) THEN
        RAISE exclusion_violation USING MESSAGE = 'Este horário já não está disponível. Escolhe outro.';
      END IF;
      saved := public.agentx_save_appointment(actor, selected.id,
        jsonb_build_object('appointment_date', p_date, 'start_time', p_start), false);
    END IF;
  END IF;

  IF saved IS NOT NULL THEN
    selected := jsonb_populate_record(NULL::public.appointments, saved->'appointment');
    IF p_action = 'reschedule' THEN
      INSERT INTO public.agentx_appointment_notifications (user_id, appointment_id, revision, kind, status, attempts, expires_at)
      VALUES (selected.user_id, selected.id, selected.schedule_revision, 'confirmation', 'retry', 0, selected.start_at);
    END IF;
    can_edit := coalesce(selected.status IN ('scheduled','confirmed'), false) AND selected.start_at > now();
  END IF;

  RETURN jsonb_build_object('userId', actor, 'replayed', replayed, 'data', jsonb_build_object(
    'id', selected.id, 'appointment_date', selected.appointment_date, 'start_time', selected.start_time,
    'end_time', selected.end_time, 'time_zone', selected.time_zone, 'status', selected.status,
    'revision', selected.schedule_revision, 'canManage', can_edit,
    'businessName', (SELECT u.name FROM public.users u WHERE u.id = actor),
    'services', (SELECT jsonb_build_object('name', s.name) FROM public.services s WHERE s.id = selected.service_id AND s.user_id = actor),
    'professionals', (SELECT jsonb_build_object('name', p.name) FROM public.professionals p
      WHERE p.id = selected.professional_id AND p.user_id = actor)
  ));
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_appointment_self_service_ready() RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT public.agentx_appointment_contract_ready()
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_class
      WHERE oid = to_regclass('public.agentx_appointment_manage_links') AND relrowsecurity)
    AND to_regprocedure('public.agentx_book_public_appointment(uuid,jsonb,text)') IS NOT NULL
    AND to_regprocedure('public.agentx_public_manage_appointment(text,text,uuid,date,text)') IS NOT NULL
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.appointments'::regclass
      AND tgname = 'agentx_revoke_appointment_manage_link' AND tgenabled IN ('O','A'));
$$;

REVOKE ALL ON FUNCTION public.agentx_revoke_appointment_manage_link(),
  public.agentx_book_public_appointment(uuid,jsonb,text), public.agentx_appointment_slots_excluding(uuid,uuid,uuid,date,uuid),
  public.agentx_public_manage_appointment(text,text,uuid,date,text), public.agentx_appointment_self_service_ready()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agentx_revoke_appointment_manage_link(),
  public.agentx_book_public_appointment(uuid,jsonb,text), public.agentx_appointment_slots_excluding(uuid,uuid,uuid,date,uuid),
  public.agentx_public_manage_appointment(text,text,uuid,date,text), public.agentx_appointment_self_service_ready() TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
