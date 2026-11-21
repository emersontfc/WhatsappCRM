BEGIN;
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
COMMIT;
NOTIFY pgrst,'reload schema';
