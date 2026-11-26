BEGIN;

INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
  ('00000000-0000-4000-8000-000000000381','direct-proof-owner@example.com',now()),
  ('00000000-0000-4000-8000-000000000382','direct-proof-other@example.com',now());
SET LOCAL ROLE service_role;

DO $$
DECLARE
  seller constant uuid := '00000000-0000-4000-8000-000000000381';
  other constant uuid := '00000000-0000-4000-8000-000000000382';
  buyer constant text := '258840000381';
  contact uuid;
  lid_contact uuid;
  product uuid;
  first_order uuid;
  second_order uuid;
  output jsonb;
  evidence uuid;
  task uuid;
  sha constant text := repeat('a',64);
  file jsonb := jsonb_build_object('path',seller::text || '/00000000-0000-4000-8000-000000000383',
    'name','prova.pdf','mime','application/pdf','size',128,'sha256',sha);
BEGIN
  ASSERT public.agentx_direct_proof_contract_ready();
  ASSERT NOT has_table_privilege('authenticated','public.agentx_direct_payment_attachments','SELECT');
  ASSERT NOT has_table_privilege('authenticated','public.agentx_direct_proof_intake_events','UPDATE');
  ASSERT public.agentx_seller_evidence_hash('primeiro','agentx-group-proof:' || sha)
    = public.agentx_seller_evidence_hash('segundo','agentx-proof-sha256:' || sha);

  INSERT INTO public.contacts(user_id,phone,name) VALUES (seller,buyer,'Comprador') RETURNING id INTO contact;
  INSERT INTO public.contacts(user_id,phone,lid,name) VALUES (seller,NULL,'198765432109876','LID') RETURNING id INTO lid_contact;
  INSERT INTO public.products(user_id,name,price,currency,stock,type)
    VALUES (seller,'Produto do comprovativo',275,'MT',2,'physical') RETURNING id INTO product;
  INSERT INTO public.agentx_seller_settings(user_id,payment_method,payment_recipient,recipient_name,notification_phone)
    VALUES (seller,'mpesa','258840000389','Loja de teste','258840000390');
  first_order := (public.agentx_seller_create_order(seller,product,1,buyer,'Comprador',contact,'mpesa',
    'AGX-PRIMEIRO-38','direct-order-a38')->>'id')::uuid;
  second_order := (public.agentx_seller_create_order(seller,product,1,buyer,'Comprador',contact,'mpesa',
    'AGX-SEGUNDO-38','direct-order-b38')->>'id')::uuid;
  UPDATE public.orders SET customer_phone='840000381' WHERE id=second_order;
  ASSERT public.agentx_resolve_direct_payment_proof_order(seller,buyer,NULL)->>'status' = 'ambiguous';
  ASSERT public.agentx_resolve_direct_payment_proof_order(seller,buyer,'AGX-PRIMEIRO-38')->>'orderId' = first_order::text;
  ASSERT public.agentx_resolve_direct_payment_proof_order(other,buyer,'AGX-PRIMEIRO-38')->>'status' = 'missing';
  ASSERT public.agentx_direct_proof_phone(seller,lid_contact,NULL) IS NULL;

  INSERT INTO public.messages(user_id,contact_id,msg_id,text,type,timestamp,media_type,agentx_live_ingress)
  VALUES (seller,contact,'ambiguous-proof38','Segue comprovativo','inbound',now(),'image',true),
    (seller,contact,'explicit-proof38','Comprovativo AGX-PRIMEIRO-38','inbound',now(),'document',true),
    (seller,contact,'same-file38','Comprovativo AGX-PRIMEIRO-38','inbound',now(),'document',true),
    (seller,contact,'history-proof38','Comprovativo AGX-SEGUNDO-38','inbound',now(),'image',false),
    (seller,contact,'stale-proof38','Comprovativo AGX-SEGUNDO-38','inbound',now()-interval '15 minutes','image',true);

  ASSERT public.agentx_record_direct_proof_intake_event(seller,contact,'ambiguous-proof38','ambiguous_order');
  ASSERT NOT public.agentx_record_direct_proof_intake_event(seller,contact,'ambiguous-proof38','ambiguous_order');
  ASSERT NOT public.agentx_record_direct_proof_intake_event(seller,contact,'history-proof38','ambiguous_order');
  ASSERT NOT public.agentx_record_direct_proof_intake_event(other,contact,'ambiguous-proof38','ambiguous_order');
  SELECT e.id INTO task FROM public.agentx_direct_proof_intake_events e WHERE e.user_id=seller;
  ASSERT NOT public.agentx_resolve_direct_proof_event(other,NULL,task);
  ASSERT public.agentx_resolve_direct_proof_event(seller,NULL,task);
  ASSERT NOT public.agentx_resolve_direct_proof_event(seller,NULL,task);

  output := public.agentx_submit_direct_payment_proof(seller,contact,buyer,'ambiguous-proof38',NULL,first_order,'{}',file);
  ASSERT output->>'status' = 'ambiguous';
  output := public.agentx_submit_direct_payment_proof(seller,contact,buyer,'explicit-proof38','AGX-SEGUNDO-38',second_order,'{}',file);
  ASSERT output->>'status' = 'ambiguous';
  output := public.agentx_submit_direct_payment_proof(other,contact,buyer,'explicit-proof38','AGX-PRIMEIRO-38',first_order,'{}',file);
  ASSERT output->>'status' = 'invalid';
  output := public.agentx_submit_direct_payment_proof(seller,contact,buyer,'stale-proof38','AGX-SEGUNDO-38',second_order,'{}',file);
  ASSERT output->>'status' = 'invalid';
  output := public.agentx_submit_direct_payment_proof(seller,contact,buyer,'explicit-proof38','AGX-PRIMEIRO-38',first_order,'{}',file);
  ASSERT output->>'status' = 'saved';
  evidence := (output->>'id')::uuid;
  ASSERT EXISTS (SELECT 1 FROM public.payment_verifications p WHERE p.id=evidence AND p.user_id=seller
    AND p.status='pending' AND p.amount=0 AND p.extracted_data->>'source'='whatsapp_private' AND p.proof_media_url='agentx-proof-sha256:' || sha);
  ASSERT EXISTS (SELECT 1 FROM public.agentx_direct_payment_attachments a WHERE a.verification_id=evidence AND a.user_id=seller
    AND a.storage_path=file->>'path' AND a.file_name='prova.pdf' AND a.mime_type='application/pdf');
  ASSERT EXISTS (SELECT 1 FROM public.orders WHERE id=first_order AND status='verification_pending' AND approved_at IS NULL);
  ASSERT EXISTS (SELECT 1 FROM public.orders WHERE id=second_order AND status='awaiting_payment');
  output := public.agentx_submit_direct_payment_proof(seller,contact,buyer,'explicit-proof38','AGX-PRIMEIRO-38',first_order,'{}',file);
  ASSERT output->>'status' = 'duplicate' AND (output->>'id')::uuid=evidence;
  output := public.agentx_submit_direct_payment_proof(seller,contact,buyer,'same-file38','AGX-PRIMEIRO-38',first_order,'{}',file);
  ASSERT output->>'status' = 'duplicate' AND (output->>'id')::uuid=evidence;
  ASSERT (SELECT count(*) FROM public.agentx_direct_payment_attachments WHERE user_id=seller)=1;
  ASSERT (SELECT count(*) FROM public.agentx_seller_notices WHERE user_id=seller AND proof_id=evidence AND kind='proof_review')=1;
END;
$$;

ROLLBACK;
