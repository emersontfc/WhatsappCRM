BEGIN;

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
COMMIT;
NOTIFY pgrst, 'reload schema';
