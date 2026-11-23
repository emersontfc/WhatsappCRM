BEGIN;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS schedule_revision uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS request_id uuid,
  ADD COLUMN IF NOT EXISTS time_zone text,
  ADD COLUMN IF NOT EXISTS start_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS agentx_appointment_request_unique
  ON public.appointments (user_id, request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agentx_appointment_calendar_lookup
  ON public.appointments (user_id, appointment_date, professional_id);
CREATE INDEX IF NOT EXISTS agentx_appointment_upcoming_lookup
  ON public.appointments (appointment_date, id)
  WHERE status IN ('scheduled', 'confirmed') AND customer_phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.agentx_appointment_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  revision uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('confirmation', 'manual', 'reminder_24h', 'reminder_2h')),
  status text NOT NULL CHECK (status IN ('sending', 'sent', 'retry', 'uncertain')),
  attempts integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  whatsapp_message_id text,
  UNIQUE (appointment_id, revision, kind)
);
CREATE INDEX IF NOT EXISTS agentx_appointment_notification_retry
  ON public.agentx_appointment_notifications (available_at) WHERE status = 'retry';
ALTER TABLE public.agentx_appointment_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agentx_appointment_notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.agentx_appointment_notifications TO service_role;

-- Browser clients use the authenticated appointment HTTP API. Writers go through the serialized RPCs.
REVOKE INSERT, UPDATE, DELETE ON public.appointments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.appointments TO service_role;

CREATE OR REPLACE FUNCTION public.agentx_appointment_timezone(p_user uuid)
RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT COALESCE((SELECT cp.timezone FROM public.company_profile cp
    WHERE cp.user_id = p_user AND EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = cp.timezone)
    LIMIT 1), 'Africa/Maputo');
$$;

CREATE OR REPLACE FUNCTION public.agentx_appointment_slot_conflict(
  p_user uuid, p_professional uuid, p_date date, p_start time, p_end time, p_exclude uuid
) RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.user_id = p_user AND a.appointment_date = p_date AND a.id IS DISTINCT FROM p_exclude
      AND COALESCE(a.status, 'scheduled') <> 'cancelled'
      AND (p_professional IS NULL OR a.professional_id IS NULL OR a.professional_id = p_professional)
      AND CASE WHEN a.start_time::text ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
               AND a.end_time::text ~ '^(([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?|24:00(:00)?)$'
        THEN a.start_time::time < p_end AND a.end_time::time > p_start
        ELSE false END
  );
$$;

CREATE OR REPLACE FUNCTION public.agentx_appointment_hours(p_user uuid, p_professional uuid, p_date date)
RETURNS TABLE (opens time, closes time, break_from time, break_to time)
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  professional public.professionals%ROWTYPE;
  weekday text := (ARRAY['sun','mon','tue','wed','thu','fri','sat'])[extract(dow FROM p_date)::integer + 1];
  workdays text[] := ARRAY['mon','tue','wed','thu','fri','sat'];
BEGIN
  IF p_professional IS NOT NULL THEN
    SELECT * INTO professional FROM public.professionals
      WHERE id = p_professional AND user_id = p_user AND active;
    IF NOT FOUND THEN RAISE no_data_found USING MESSAGE = 'Profissional indisponível.'; END IF;
    workdays := COALESCE(professional.working_days, workdays);
  END IF;
  IF NOT COALESCE(weekday = ANY(workdays), false) THEN RETURN; END IF;
  IF p_professional IS NULL THEN
    RETURN QUERY SELECT '08:00'::time, '17:00'::time, '12:00'::time, '13:00'::time;
  ELSE
    RETURN QUERY SELECT
      COALESCE(NULLIF(professional.start_time::text, ''), '08:00')::time,
      COALESCE(NULLIF(professional.end_time::text, ''), '17:00')::time,
      NULLIF(professional.break_start::text, '')::time,
      NULLIF(professional.break_end::text, '')::time;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_available_appointment_slots(
  p_user uuid, p_service uuid, p_professional uuid, p_date date
) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  zone text := public.agentx_appointment_timezone(p_user);
  duration integer := 30;
  hours record;
  slot timestamp;
  slots jsonb := '[]'::jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user) THEN
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
    p_date + hours.opens,
    p_date + hours.closes - make_interval(mins => duration),
    make_interval(mins => duration)
  ) LOOP
    IF (slot AT TIME ZONE zone) <= now() OR ((slot AT TIME ZONE zone) AT TIME ZONE zone) <> slot
      OR (hours.break_from IS NOT NULL AND hours.break_to IS NOT NULL
          AND slot::time < hours.break_to AND slot + make_interval(mins => duration) > p_date + hours.break_from)
      OR public.agentx_appointment_slot_conflict(p_user, p_professional, p_date, slot::time,
        (slot + make_interval(mins => duration))::time, NULL) THEN
      CONTINUE;
    END IF;
    slots := slots || jsonb_build_array(to_char(slot, 'HH24:MI'));
  END LOOP;
  RETURN jsonb_build_object('timeZone', zone, 'durationMinutes', duration, 'slots', slots);
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_save_appointment(
  p_user uuid, p_appointment uuid, p_input jsonb, p_public boolean
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  existing public.appointments%ROWTYPE;
  candidate public.appointments%ROWTYPE;
  allowed jsonb;
  contact_phone text;
  normalized_phone text;
  duration integer := 30;
  zone text;
  begin_at timestamp;
  end_at timestamp;
  hours record;
  slots jsonb;
  schedule_changed boolean;
  notification_changed boolean;
  new_status text;
BEGIN
  IF p_user IS NULL OR p_input IS NULL OR jsonb_typeof(p_input) <> 'object' OR p_public IS NULL THEN
    RAISE invalid_parameter_value USING MESSAGE = 'Dados de marcação inválidos.';
  END IF;
  IF p_public AND (p_appointment IS NOT NULL OR NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user)) THEN
    RAISE no_data_found USING MESSAGE = 'Estabelecimento indisponível.';
  END IF;

  -- All saves/deletes for an account serialize, even when professional is omitted.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text || ':appointments', 0));
  IF p_appointment IS NOT NULL THEN
    SELECT * INTO existing FROM public.appointments WHERE id = p_appointment AND user_id = p_user FOR UPDATE;
    IF NOT FOUND THEN RAISE no_data_found USING MESSAGE = 'Marcação não encontrada.'; END IF;
  END IF;
  SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb) INTO allowed
  FROM jsonb_each(p_input)
  WHERE key IN ('contact_id','service_id','professional_id','customer_name','customer_phone',
    'appointment_date','start_time','end_time','status','notes','request_id');
  IF p_public THEN allowed := allowed - ARRAY['contact_id','status','end_time']; END IF;
  candidate := jsonb_populate_record(existing, allowed);
  candidate.user_id := p_user;
  candidate.customer_name := btrim(candidate.customer_name);
  new_status := CASE WHEN p_public THEN 'scheduled' ELSE COALESCE(candidate.status, 'scheduled') END;
  candidate.status := new_status;
  IF candidate.customer_name IS NULL OR length(candidate.customer_name) NOT BETWEEN 1 AND 150
    OR length(candidate.notes) > 1000 OR candidate.appointment_date IS NULL
    OR candidate.start_time IS NULL OR candidate.start_time::text !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
    OR new_status NOT IN ('scheduled','confirmed','completed','cancelled') THEN
    RAISE invalid_parameter_value USING MESSAGE = 'Confere o nome, a data, o horário e o estado da marcação.';
  END IF;
  normalized_phone := public.agentx_contact_phone(candidate.customer_phone);
  IF (candidate.customer_phone IS NOT NULL OR p_public) AND normalized_phone IS NULL THEN
    IF p_appointment IS NULL OR p_public OR p_input ? 'customer_phone' THEN
      RAISE invalid_parameter_value USING MESSAGE = 'Indica um número de WhatsApp válido.';
    END IF;
  END IF;

  IF p_appointment IS NULL AND candidate.request_id IS NOT NULL THEN
    SELECT * INTO existing FROM public.appointments WHERE user_id = p_user AND request_id = candidate.request_id;
    IF FOUND THEN
      IF existing.appointment_date <> candidate.appointment_date OR existing.start_time::time <> candidate.start_time::time
        OR existing.service_id IS DISTINCT FROM candidate.service_id
        OR existing.professional_id IS DISTINCT FROM candidate.professional_id
        OR public.agentx_contact_phone(existing.customer_phone) IS DISTINCT FROM normalized_phone
        OR existing.customer_name IS DISTINCT FROM candidate.customer_name THEN
        RAISE exclusion_violation USING MESSAGE = 'Este pedido de marcação já foi utilizado para outros dados.';
      END IF;
      RETURN jsonb_build_object('appointment', to_jsonb(existing), 'replayed', true);
    END IF;
  END IF;
  IF p_appointment IS NOT NULL THEN candidate.request_id := existing.request_id; END IF;

  IF candidate.contact_id IS NOT NULL THEN
    SELECT public.agentx_contact_phone(c.phone) INTO contact_phone
    FROM public.contacts c WHERE c.id = candidate.contact_id AND c.user_id = p_user FOR SHARE;
    IF NOT FOUND THEN RAISE no_data_found USING MESSAGE = 'Contacto indisponível.'; END IF;
    IF p_input ? 'customer_phone' AND normalized_phone IS DISTINCT FROM contact_phone THEN
      IF p_input ? 'contact_id' AND normalized_phone IS NOT NULL THEN
        RAISE invalid_parameter_value USING MESSAGE = 'O telefone não corresponde ao contacto.';
      END IF;
      candidate.contact_id := NULL;
    ELSE
      normalized_phone := COALESCE(normalized_phone, contact_phone);
    END IF;
  END IF;
  IF normalized_phone IS NOT NULL OR p_input ? 'customer_phone' THEN candidate.customer_phone := normalized_phone; END IF;

  schedule_changed := p_appointment IS NULL
    OR existing.appointment_date IS DISTINCT FROM candidate.appointment_date
    OR existing.start_time::time IS DISTINCT FROM candidate.start_time::time
    OR existing.end_time::time IS DISTINCT FROM candidate.end_time::time
    OR existing.professional_id IS DISTINCT FROM candidate.professional_id
    OR existing.service_id IS DISTINCT FROM candidate.service_id
    OR (COALESCE(existing.status, 'scheduled') NOT IN ('scheduled','confirmed') AND new_status IN ('scheduled','confirmed'));
  IF candidate.service_id IS NOT NULL THEN
    SELECT COALESCE(s.duration_minutes, 30) INTO duration FROM public.services s
      WHERE s.id = candidate.service_id AND s.user_id = p_user AND (s.active OR NOT schedule_changed)
      FOR SHARE;
    IF NOT FOUND THEN RAISE no_data_found USING MESSAGE = 'Serviço indisponível.'; END IF;
  END IF;
  IF duration NOT BETWEEN 1 AND 1440 THEN RAISE invalid_parameter_value USING MESSAGE = 'Duração do serviço inválida.'; END IF;
  IF candidate.professional_id IS NOT NULL THEN
    PERFORM 1 FROM public.professionals prof WHERE prof.id = candidate.professional_id AND prof.user_id = p_user
      AND (prof.active OR NOT schedule_changed) FOR SHARE;
    IF NOT FOUND THEN RAISE no_data_found USING MESSAGE = 'Profissional indisponível.'; END IF;
  END IF;

  IF candidate.end_time IS NOT NULL AND candidate.end_time::text !~ '^(([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?|24:00(:00)?)$' THEN
    RAISE invalid_parameter_value USING MESSAGE = 'Hora de fim inválida.';
  END IF;
  begin_at := candidate.appointment_date + candidate.start_time::time;
  IF candidate.end_time IS NULL OR (schedule_changed AND NOT (p_input ? 'end_time')) THEN
    end_at := begin_at + make_interval(mins => duration);
  ELSE
    end_at := candidate.appointment_date + candidate.end_time::time;
  END IF;
  IF end_at <= begin_at OR end_at > candidate.appointment_date + interval '1 day' THEN
    RAISE invalid_parameter_value USING MESSAGE = 'A marcação deve terminar no mesmo dia, depois da hora de início.';
  END IF;
  IF candidate.end_time IS NULL OR schedule_changed OR p_input ? 'end_time' THEN
    candidate.end_time := CASE WHEN end_at = candidate.appointment_date + interval '1 day' THEN '24:00'
      WHEN extract(second FROM end_at) = 0 THEN to_char(end_at, 'HH24:MI') ELSE to_char(end_at, 'HH24:MI:SS') END;
  END IF;
  IF (p_appointment IS NULL OR p_input ? 'start_time') AND extract(second FROM begin_at) = 0 THEN
    candidate.start_time := to_char(begin_at, 'HH24:MI');
  END IF;

  zone := CASE WHEN schedule_changed THEN public.agentx_appointment_timezone(p_user)
    ELSE COALESCE(existing.time_zone, public.agentx_appointment_timezone(p_user)) END;
  candidate.time_zone := zone;
  candidate.start_at := CASE WHEN NOT schedule_changed AND existing.start_at IS NOT NULL THEN existing.start_at
    ELSE begin_at AT TIME ZONE zone END;
  IF schedule_changed AND new_status IN ('scheduled','confirmed') THEN
    IF candidate.start_at <= now() OR (candidate.start_at AT TIME ZONE zone) <> begin_at THEN
      RAISE invalid_parameter_value USING MESSAGE = 'Escolhe um horário futuro válido no fuso horário da empresa.';
    END IF;
    IF p_public THEN
      slots := public.agentx_available_appointment_slots(p_user, candidate.service_id, candidate.professional_id, candidate.appointment_date);
      IF NOT ((slots->'slots') ? to_char(begin_at, 'HH24:MI')) THEN
        RAISE exclusion_violation USING MESSAGE = 'Este horário já não está disponível. Escolhe outro.';
      END IF;
    ELSIF candidate.professional_id IS NOT NULL THEN
      SELECT * INTO hours FROM public.agentx_appointment_hours(p_user, candidate.professional_id, candidate.appointment_date);
      IF NOT FOUND OR begin_at < candidate.appointment_date + hours.opens OR end_at > candidate.appointment_date + hours.closes
        OR (hours.break_from IS NOT NULL AND hours.break_to IS NOT NULL
            AND begin_at < candidate.appointment_date + hours.break_to AND end_at > candidate.appointment_date + hours.break_from) THEN
        RAISE exclusion_violation USING MESSAGE = 'O horário fica fora da disponibilidade do profissional.';
      END IF;
    END IF;
    IF public.agentx_appointment_slot_conflict(p_user, candidate.professional_id, candidate.appointment_date,
        begin_at::time, candidate.end_time::time, p_appointment) THEN
      RAISE exclusion_violation USING MESSAGE = 'Este horário já não está disponível. Escolhe outro.';
    END IF;
  END IF;

  notification_changed := schedule_changed OR public.agentx_contact_phone(existing.customer_phone) IS DISTINCT FROM normalized_phone
    OR existing.start_at IS DISTINCT FROM candidate.start_at AND existing.start_at IS NOT NULL;
  IF p_appointment IS NOT NULL AND (notification_changed OR new_status NOT IN ('scheduled','confirmed')) AND EXISTS (
    SELECT 1 FROM public.agentx_appointment_notifications n
    WHERE n.user_id = p_user AND n.appointment_id = p_appointment AND n.revision = existing.schedule_revision
      AND n.status = 'sending' AND n.updated_at > now() - interval '2 minutes'
  ) THEN RAISE exclusion_violation USING MESSAGE = 'Aguarda o envio em curso antes de alterar esta marcação.'; END IF;
  IF normalized_phone IS NOT NULL AND candidate.contact_id IS NULL THEN
    candidate.contact_id := (public.agentx_save_contact(p_user, normalized_phone, candidate.customer_name,
      p_tags => ARRAY[CASE WHEN p_public THEN 'Agendamento Online' ELSE 'Marcação' END])->>'id')::uuid;
    IF candidate.contact_id IS NULL THEN RAISE invalid_parameter_value USING MESSAGE = 'Não foi possível guardar o contacto da marcação.'; END IF;
  END IF;

  IF p_appointment IS NULL THEN
    INSERT INTO public.appointments (user_id, contact_id, service_id, professional_id, customer_name, customer_phone,
      appointment_date, start_time, end_time, status, notes, request_id, time_zone, start_at)
    VALUES (p_user, candidate.contact_id, candidate.service_id, candidate.professional_id,
      candidate.customer_name, candidate.customer_phone, candidate.appointment_date, candidate.start_time,
      candidate.end_time, candidate.status, candidate.notes, candidate.request_id, zone, candidate.start_at)
    RETURNING * INTO candidate;
    IF p_public THEN
      INSERT INTO public.agentx_appointment_notifications (user_id, appointment_id, revision, kind, status, attempts, expires_at)
      VALUES (p_user, candidate.id, candidate.schedule_revision, 'confirmation', 'retry', 0, candidate.start_at);
    END IF;
  ELSE
    UPDATE public.appointments SET contact_id = candidate.contact_id, service_id = candidate.service_id,
      professional_id = candidate.professional_id, customer_name = candidate.customer_name,
      customer_phone = candidate.customer_phone, appointment_date = candidate.appointment_date,
      start_time = candidate.start_time, end_time = candidate.end_time, status = candidate.status, notes = candidate.notes,
      time_zone = zone, start_at = candidate.start_at,
      schedule_revision = CASE WHEN notification_changed THEN gen_random_uuid() ELSE existing.schedule_revision END,
      reminder_24h_sent = CASE WHEN notification_changed THEN false ELSE existing.reminder_24h_sent END,
      reminder_2h_sent = CASE WHEN notification_changed THEN false ELSE existing.reminder_2h_sent END
    WHERE id = p_appointment AND user_id = p_user RETURNING * INTO candidate;
  END IF;
  RETURN jsonb_build_object('appointment', to_jsonb(candidate), 'replayed', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_delete_appointment(p_user uuid, p_appointment uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text || ':appointments', 0));
  PERFORM 1 FROM public.appointments WHERE id = p_appointment AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF EXISTS (
    SELECT 1 FROM public.agentx_appointment_notifications n
    WHERE n.user_id = p_user AND n.appointment_id = p_appointment AND n.status = 'sending'
      AND n.updated_at > now() - interval '2 minutes'
  ) THEN RAISE exclusion_violation USING MESSAGE = 'Aguarda o envio em curso antes de excluir esta marcação.'; END IF;
  DELETE FROM public.appointments WHERE id = p_appointment AND user_id = p_user;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_claim_appointment_notification(
  p_user uuid, p_appointment uuid, p_revision uuid, p_kind text
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  appointment public.appointments%ROWTYPE;
  notification public.agentx_appointment_notifications%ROWTYPE;
  zone text;
  scheduled timestamptz;
  expires timestamptz;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('confirmation','manual','reminder_24h','reminder_2h') THEN
    RAISE invalid_parameter_value USING MESSAGE = 'Lembrete inválido.';
  END IF;
  SELECT * INTO appointment FROM public.appointments WHERE id = p_appointment AND user_id = p_user FOR UPDATE;
  IF NOT FOUND OR appointment.schedule_revision IS DISTINCT FROM p_revision THEN
    RETURN jsonb_build_object('status', 'ineligible');
  END IF;
  SELECT * INTO notification FROM public.agentx_appointment_notifications n
    WHERE n.user_id = p_user AND n.appointment_id = p_appointment AND n.revision = p_revision AND n.kind = p_kind;
  IF notification.status = 'sent' OR (p_kind = 'reminder_24h' AND appointment.reminder_24h_sent)
    OR (p_kind = 'reminder_2h' AND appointment.reminder_2h_sent) THEN
    RETURN jsonb_build_object('status', 'sent');
  END IF;
  IF notification.status = 'uncertain' OR (notification.status = 'sending' AND notification.updated_at <= now() - interval '2 minutes') THEN
    RETURN jsonb_build_object('status', 'uncertain');
  END IF;
  IF notification.status = 'sending' OR (notification.status = 'retry' AND notification.available_at > now()) THEN
    RETURN jsonb_build_object('status', notification.status);
  END IF;
  IF COALESCE(appointment.status, 'scheduled') NOT IN ('scheduled','confirmed')
    OR public.agentx_contact_phone(appointment.customer_phone) IS NULL
    OR appointment.start_time::text !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' THEN
    RETURN jsonb_build_object('status', 'ineligible');
  END IF;

  zone := COALESCE(appointment.time_zone, public.agentx_appointment_timezone(p_user));
  scheduled := COALESCE(appointment.start_at, (appointment.appointment_date + appointment.start_time::time) AT TIME ZONE zone);
  expires := CASE WHEN p_kind = 'reminder_24h' THEN scheduled - interval '2 hours' ELSE scheduled END;
  IF now() >= expires OR (p_kind = 'reminder_24h' AND scheduled > now() + interval '24 hours')
    OR (p_kind = 'reminder_2h' AND scheduled > now() + interval '2 hours') THEN
    RETURN jsonb_build_object('status', 'ineligible');
  END IF;

  IF notification.id IS NULL THEN
    INSERT INTO public.agentx_appointment_notifications (user_id, appointment_id, revision, kind, status, expires_at)
    VALUES (p_user, p_appointment, p_revision, p_kind, 'sending', expires) RETURNING * INTO notification;
  ELSE
    UPDATE public.agentx_appointment_notifications SET status = 'sending', attempts = attempts + 1, updated_at = now(), expires_at = expires
      WHERE id = notification.id AND user_id = p_user RETURNING * INTO notification;
  END IF;
  RETURN jsonb_build_object('id', notification.id, 'status', 'claimed',
    'appointment', jsonb_build_object('appointment_date', appointment.appointment_date,
      'start_time', appointment.start_time, 'time_zone', zone, 'start_at', scheduled, 'customer_phone', appointment.customer_phone));
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_finish_appointment_notification(
  p_user uuid, p_notification uuid, p_status text, p_message_id text
) RETURNS boolean LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  notification public.agentx_appointment_notifications%ROWTYPE;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('sent','retry','uncertain')
    OR (p_status = 'sent' AND NULLIF(btrim(p_message_id), '') IS NULL) THEN
    RAISE invalid_parameter_value USING MESSAGE = 'Confirmação do WhatsApp inválida.';
  END IF;
  SELECT * INTO notification FROM public.agentx_appointment_notifications WHERE id = p_notification AND user_id = p_user;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM public.appointments WHERE id = notification.appointment_id AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.agentx_appointment_notifications SET status = p_status, updated_at = now(),
    whatsapp_message_id = CASE WHEN p_status = 'sent' THEN p_message_id ELSE NULL END,
    available_at = now() + make_interval(secs => least(900, 60 * attempts))
    WHERE id = p_notification AND user_id = p_user AND status = 'sending' RETURNING * INTO notification;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_status = 'sent' AND notification.kind IN ('reminder_24h','reminder_2h') THEN
    UPDATE public.appointments SET
      reminder_24h_sent = CASE WHEN notification.kind = 'reminder_24h' THEN true ELSE reminder_24h_sent END,
      reminder_2h_sent = CASE WHEN notification.kind = 'reminder_2h' THEN true ELSE reminder_2h_sent END
    WHERE id = notification.appointment_id AND user_id = p_user AND schedule_revision = notification.revision;
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_appointment_contract_ready()
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT to_regclass('public.agentx_appointment_request_unique') IS NOT NULL
    AND to_regclass('public.agentx_appointment_notifications') IS NOT NULL
    AND to_regprocedure('public.agentx_available_appointment_slots(uuid,uuid,uuid,date)') IS NOT NULL
    AND to_regprocedure('public.agentx_save_appointment(uuid,uuid,jsonb,boolean)') IS NOT NULL
    AND to_regprocedure('public.agentx_claim_appointment_notification(uuid,uuid,uuid,text)') IS NOT NULL
    AND to_regprocedure('public.agentx_finish_appointment_notification(uuid,uuid,text,text)') IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.agentx_appointment_timezone(uuid),
  public.agentx_appointment_slot_conflict(uuid,uuid,date,time,time,uuid), public.agentx_appointment_hours(uuid,uuid,date),
  public.agentx_available_appointment_slots(uuid,uuid,uuid,date), public.agentx_save_appointment(uuid,uuid,jsonb,boolean),
  public.agentx_delete_appointment(uuid,uuid), public.agentx_claim_appointment_notification(uuid,uuid,uuid,text),
  public.agentx_finish_appointment_notification(uuid,uuid,text,text), public.agentx_appointment_contract_ready()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agentx_appointment_timezone(uuid),
  public.agentx_appointment_slot_conflict(uuid,uuid,date,time,time,uuid), public.agentx_appointment_hours(uuid,uuid,date),
  public.agentx_available_appointment_slots(uuid,uuid,uuid,date), public.agentx_save_appointment(uuid,uuid,jsonb,boolean),
  public.agentx_delete_appointment(uuid,uuid), public.agentx_claim_appointment_notification(uuid,uuid,uuid,text),
  public.agentx_finish_appointment_notification(uuid,uuid,text,text), public.agentx_appointment_contract_ready()
  TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
