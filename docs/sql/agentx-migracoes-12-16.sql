-- AgentX ac7ab1a | Supabase SQL Editor | Migrações 12–16
BEGIN;

-- 12_catalog_deliverables.sql

INSERT INTO storage.buckets(id, name, public, file_size_limit)
VALUES ('agentx-product-files', 'agentx-product-files', false, 20971520)
ON CONFLICT (id) DO NOTHING;
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'agentx-product-files' AND NOT public) THEN
   RAISE EXCEPTION 'AgentX product bucket must be private';
 END IF;
END;
$$;

DROP POLICY IF EXISTS agentx_private_product_objects ON storage.objects;
CREATE POLICY agentx_private_product_objects ON storage.objects AS RESTRICTIVE FOR ALL TO anon, authenticated
USING (bucket_id <> 'agentx-product-files') WITH CHECK (bucket_id <> 'agentx-product-files');
DROP POLICY IF EXISTS agentx_private_product_bucket ON storage.buckets;
CREATE POLICY agentx_private_product_bucket ON storage.buckets AS RESTRICTIVE FOR ALL TO anon, authenticated
USING (id <> 'agentx-product-files') WITH CHECK (id <> 'agentx-product-files');

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS deliverable_path text,
 ADD COLUMN IF NOT EXISTS deliverable_name text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_started_at timestamptz,
 ADD COLUMN IF NOT EXISTS delivery_error text;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS deliverable_snapshot jsonb;

-- Legacy commerce is reached through authenticated HTTP routes, never writable by the browser.
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.products, public.orders, public.order_items, public.payment_verifications,
 public.agent_operations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products, public.orders, public.order_items,
 public.payment_verifications, public.agent_operations TO service_role;

CREATE OR REPLACE FUNCTION public.agentx_catalog_create_order(
 p_user uuid, p_product uuid, p_quantity integer, p_phone text, p_customer text,
 p_contact uuid, p_method text, p_order_number text
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
 product public.products%ROWTYPE;
 created public.orders%ROWTYPE;
BEGIN
 IF p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 999
 OR p_phone IS NULL OR p_phone !~ '^[0-9]{8,15}$'
 OR p_method IS NULL OR p_method NOT IN ('mpesa','emola','bank_transfer','reference','other') THEN
   RAISE EXCEPTION 'Dados do pedido inválidos';
 END IF;

 SELECT * INTO product FROM public.products WHERE id = p_product AND user_id = p_user AND is_active FOR SHARE;
 IF NOT FOUND OR coalesce(product.stock, 0) < p_quantity OR product.price <= 0 THEN
   RAISE EXCEPTION 'Produto indisponível ou sem stock suficiente';
 END IF;

 INSERT INTO public.orders(order_number,user_id,contact_id,customer_name,customer_phone,total_amount,currency,status,payment_method)
 VALUES (p_order_number,p_user,p_contact,p_customer,p_phone,product.price*p_quantity,product.currency,'awaiting_payment',p_method)
 RETURNING * INTO created;

 INSERT INTO public.order_items(order_id,product_id,product_name,quantity,unit_price,total_price,deliverable_snapshot)
 VALUES (created.id,product.id,product.name,p_quantity,product.price,created.total_amount,
   jsonb_build_object('type',product.type,'text',product.digital_content,'path',product.deliverable_path,'name',product.deliverable_name));
 RETURN to_jsonb(created);
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_catalog_approve_order(p_user uuid, p_order uuid, p_note text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
 approved public.orders%ROWTYPE;
BEGIN
 SELECT * INTO approved FROM public.orders WHERE id = p_order AND user_id = p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado' USING ERRCODE = 'P0002'; END IF;
 IF approved.status IN ('paid','fulfilled') THEN RETURN to_jsonb(approved); END IF;
 IF approved.status <> 'verification_pending' THEN RAISE EXCEPTION 'Pedido fora da fila de verificação'; END IF;
 UPDATE public.payment_verifications SET status = 'approved', reviewed_by = p_user, reviewed_at = now()
 WHERE order_id = p_order AND user_id = p_user AND status = 'pending';
 IF NOT FOUND THEN RAISE EXCEPTION 'Pedido sem comprovativo pendente'; END IF;
 UPDATE public.orders SET status = 'paid', approved_by = p_user, approved_at = now(),
 verification_notes = p_note, updated_at = now() WHERE id = p_order RETURNING * INTO approved;
 INSERT INTO public.agent_operations(user_id,order_id,phone,step,description)
 VALUES (p_user,p_order,approved.customer_phone,'admin_approved','Pagamento validado pelo responsável da conta.');
 RETURN to_jsonb(approved);
END;
$$;

REVOKE ALL ON FUNCTION public.agentx_catalog_create_order(uuid,uuid,integer,text,text,uuid,text,text),
 public.agentx_catalog_approve_order(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agentx_catalog_create_order(uuid,uuid,integer,text,text,uuid,text,text),
 public.agentx_catalog_approve_order(uuid,uuid,text) TO service_role;

-- 13_whatsapp_operator.sql
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

-- 14_whatsapp_sales_pipeline.sql
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS source_message_id text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tracks_catalog_stock boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS agentx_order_source_message_uidx
 ON public.orders(user_id,source_message_id) WHERE source_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agentx_orders_lead_idx ON public.orders(user_id,lead_id);

CREATE OR REPLACE FUNCTION public.agentx_capture_sales_lead(
 p_user uuid, p_phone text, p_contact uuid, p_name text, p_activity text, p_message text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
 lead public.leads%ROWTYPE;
 c public.contacts%ROWTYPE;
 canonical_phone text;
BEGIN
 IF p_phone IS NULL OR p_phone !~ '^[0-9]{8,15}$'
 OR p_activity IS NULL OR p_activity NOT IN ('catalog','interest','order','sold') THEN
   RAISE EXCEPTION 'Identidade ou atividade comercial inválida';
 END IF;
 canonical_phone := CASE WHEN p_phone ~ '^8[2-7][0-9]{7}$' THEN '258'||p_phone ELSE p_phone END;
 IF p_contact IS NOT NULL THEN
   SELECT * INTO c FROM public.contacts WHERE id = p_contact AND user_id = p_user;
   IF NOT FOUND THEN RAISE EXCEPTION 'Contacto não pertence à conta' USING ERRCODE = '42501'; END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user::text || ':' || canonical_phone, 0));
 SELECT * INTO lead FROM public.leads l WHERE l.user_id = p_user
 AND (l.contact_id = p_contact OR regexp_replace(l.phone, '[^0-9]', '', 'g') IN (
   canonical_phone, p_phone, CASE WHEN canonical_phone ~ '^2588[2-7][0-9]{7}$' THEN substring(canonical_phone FROM 4) ELSE canonical_phone END
 ))
 ORDER BY (l.contact_id IS NOT DISTINCT FROM p_contact) DESC, l.created_at, l.id LIMIT 1 FOR UPDATE;
 IF NOT FOUND THEN
   INSERT INTO public.leads(user_id,phone,contact_id,name,stage,status,last_message,last_action,source)
   VALUES (p_user,canonical_phone,p_contact,coalesce(nullif(c.name,''),nullif(p_name,''),canonical_phone),
     CASE p_activity WHEN 'sold' THEN 'venda_fechada' WHEN 'order' THEN 'proposta_enviada' ELSE 'em_atendimento' END,
     CASE p_activity WHEN 'sold' THEN 'closed' WHEN 'order' THEN 'qualified' ELSE 'contacted' END,
     left(coalesce(p_message,''),500),
     CASE p_activity WHEN 'sold' THEN 'Pagamento confirmado' WHEN 'order' THEN 'Pedido criado · a aguardar pagamento' WHEN 'interest' THEN 'Interesse registado pelo agente' ELSE 'Consulta ao catálogo' END,
     'whatsapp')
   ON CONFLICT (user_id,phone) DO NOTHING RETURNING * INTO lead;
   IF FOUND THEN RETURN lead.id; END IF;
   SELECT * INTO STRICT lead FROM public.leads l WHERE l.user_id=p_user AND l.phone=canonical_phone FOR UPDATE;
 END IF;

 UPDATE public.leads SET contact_id = coalesce(contact_id,p_contact),
   last_message = coalesce(nullif(left(p_message,500),''),last_message),
   last_action = CASE
     WHEN p_activity='sold' THEN 'Pagamento confirmado'
     WHEN p_activity='order' THEN 'Pedido criado · a aguardar pagamento'
     WHEN p_activity='interest' THEN 'Interesse registado pelo agente'
     ELSE 'Consulta ao catálogo' END,
   stage = CASE WHEN p_activity='sold' OR stage='venda_fechada' OR status='closed' THEN 'venda_fechada'
     WHEN p_activity='order' THEN 'proposta_enviada'
     WHEN stage IS NULL OR stage='novo' THEN 'em_atendimento' ELSE stage END,
   status = CASE WHEN p_activity='sold' OR stage='venda_fechada' OR status='closed' THEN 'closed'
     WHEN p_activity='order' THEN 'qualified'
     WHEN stage IS NULL OR stage='novo' THEN 'contacted' ELSE status END,
   updated_at=now()
 WHERE id=lead.id;
 RETURN lead.id;
END;
$$;

-- Retains the pre-upgrade RPC. The new entry point also deduplicates the inbound WhatsApp message.
CREATE OR REPLACE FUNCTION public.agentx_whatsapp_create_order(
 p_user uuid, p_product uuid, p_quantity integer, p_phone text, p_customer text,
 p_contact uuid, p_method text, p_order_number text, p_source_message text
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
 created jsonb;
 linked_lead uuid;
BEGIN
 IF p_source_message IS NOT NULL THEN
   IF length(p_source_message) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'Mensagem inválida'; END IF;
   PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user::text||':wa-order:'||p_source_message,0));
   SELECT to_jsonb(o) INTO created FROM public.orders o WHERE o.user_id=p_user AND o.source_message_id=p_source_message;
   IF FOUND THEN RETURN created; END IF;
 END IF;

 linked_lead := public.agentx_capture_sales_lead(p_user,p_phone,p_contact,p_customer,'order');
 created := public.agentx_catalog_create_order(p_user,p_product,p_quantity,p_phone,p_customer,p_contact,p_method,p_order_number);
 UPDATE public.orders o SET lead_id=linked_lead, source_message_id=p_source_message, tracks_catalog_stock=true
   WHERE o.id=(created->>'id')::uuid RETURNING to_jsonb(o) INTO created;
 INSERT INTO public.agent_operations(user_id,order_id,contact_id,phone,step,description)
 VALUES (p_user,(created->>'id')::uuid,p_contact,p_phone,'order_created','Pedido criado pelo agente. A aguardar pagamento.');
 RETURN created;
END;
$$;

CREATE OR REPLACE FUNCTION public.agentx_catalog_approve_order(p_user uuid, p_order uuid, p_note text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
 approved public.orders%ROWTYPE;
 item record;
 linked_lead uuid;
BEGIN
 SELECT * INTO approved FROM public.orders WHERE id=p_order AND user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado' USING ERRCODE = 'P0002'; END IF;
 IF approved.status IN ('paid','fulfilled') THEN RETURN to_jsonb(approved); END IF;
 IF approved.status <> 'verification_pending' THEN RAISE EXCEPTION 'Pedido fora da fila de verificação'; END IF;

 IF approved.tracks_catalog_stock THEN
   linked_lead := public.agentx_capture_sales_lead(p_user,approved.customer_phone,approved.contact_id,approved.customer_name,'sold');
 END IF;
 UPDATE public.payment_verifications SET status='approved', reviewed_by=p_user, reviewed_at=now()
 WHERE order_id=p_order AND user_id=p_user AND status='pending';
 IF NOT FOUND THEN RAISE EXCEPTION 'Pedido sem comprovativo pendente'; END IF;

 -- Orders created by the new flow account for stock exactly once at confirmation.
 IF approved.tracks_catalog_stock THEN
   FOR item IN SELECT product_id, sum(quantity) AS units FROM public.order_items
     WHERE order_id=p_order AND product_id IS NOT NULL GROUP BY product_id ORDER BY product_id
   LOOP
     UPDATE public.products SET stock=stock-item.units, updated_at=now()
       WHERE id=item.product_id AND user_id=p_user AND stock>=item.units;
     IF NOT FOUND THEN RAISE EXCEPTION 'Stock insuficiente para confirmar esta venda'; END IF;
   END LOOP;
 END IF;
 UPDATE public.orders SET status='paid', approved_by=p_user, approved_at=now(),
   verification_notes=p_note, lead_id=coalesce(linked_lead,lead_id), updated_at=now()
 WHERE id=p_order RETURNING * INTO approved;
 INSERT INTO public.agent_operations(user_id,order_id,phone,step,description)
 VALUES (p_user,p_order,approved.customer_phone,'admin_approved','Pagamento validado pelo responsável da conta.');
 RETURN to_jsonb(approved);
END;
$$;

REVOKE ALL ON FUNCTION public.agentx_capture_sales_lead(uuid,text,uuid,text,text,text),
 public.agentx_whatsapp_create_order(uuid,uuid,integer,text,text,uuid,text,text,text),
 public.agentx_catalog_approve_order(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.agentx_capture_sales_lead(uuid,text,uuid,text,text,text),
 public.agentx_whatsapp_create_order(uuid,uuid,integer,text,text,uuid,text,text,text),
 public.agentx_catalog_approve_order(uuid,uuid,text) TO service_role;

-- 15_whatsapp_group_moderation.sql
CREATE TABLE IF NOT EXISTS public.agentx_group_events (
 id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 group_jid text NOT NULL,
 rule text NOT NULL CHECK(rule IN ('link','spam','flood','welcome')),
 outcome text NOT NULL CHECK(outcome IN ('accepted','no_permission','unverified_sender','failed')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agentx_group_events_scoped_idx
 ON public.agentx_group_events(user_id,group_jid,id DESC);
ALTER TABLE public.agentx_group_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agentx_group_events FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.agentx_group_events TO service_role;
GRANT USAGE ON SEQUENCE public.agentx_group_events_id_seq TO service_role;

-- 16_whatsapp_recurring_posts.sql
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

NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT 'Migrações 12–16 concluídas' AS resultado;
