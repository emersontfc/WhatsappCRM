# AgentX 2.0 — Functional contracts and delivery gates
Status: architecture specification (not yet implemented). Branch: feat/agentx-v2-foundation.

## Product mandate
A multi-tenant commercial automation SaaS. No n8n dependency. Preserve the current production system until tests and migration pass. All company records carry organization_id. Authorize access from the authenticated session and verified membership, never from an untrusted body/AI parameter. Never expose service-role keys, gateway secrets or customer files to the browser.

## Functional modules
### 1. Group administration
- Per-organization WhatsApp connection and per-group rules: join greetings, anti-spam, anti-flood, disallowed links, explicit keyword rules, blocked media categories where reliable detection exists, escalation, warning threshold, optional removal/ban.
- Maintain group-specific allowlists, administrator exceptions, violation history and appeal/review; never automatically ban on AI-only uncertain classification.
- Delete messages or remove members ONLY when the linked account is a group admin and the chosen channel supports the action. Reflect API limits and failures in the UI; don't advertise unsupported actions.
- Group reports, safe rate limits and opt-in automated announcements.

### 2. Orders, manual proof verification and payment gateway
- Orders belong to organization_id and reference a specific customer and product snapshot (currency, price, tax, quantity).
- Payment methods: gateway webhook confirmation OR manual transfer/M-Pesa proof. Never mark a proof-paid merely because OCR or AI thinks it is authentic.
- Uploaded proof goes to private scoped storage with file limits, malware scanning where available, authorized access, and a hash to flag repeats. Store reference, amount, currency, method, payer reference, review state and timestamps.
- Notify organization-configured approvers (verified WhatsApp contact or in-app); include signed expiring dashboard link, not actionable 'reply YES' approvals.
- Manual confirmation requires session authentication, membership role 'owner'/'finance_admin', and auditable approve/reject action, with reason and order-level locking. Approver must verify settlement independently before approval.
- Gateway webhooks: signature verification, event ID deduplication, merchant ownership binding, amount/currency comparison and authoritative status recheck if supported.
- Financial transitions idempotent; prevent cross-tenant approvals and double delivery/refunds. No platform custody of merchants' funds in MVP.

### 3. Products and digital fulfilment
- Product CRUD, visibility, price, stock, images, catalog and variants. Digital assets stored privately per organization, not public links.
- Deliverable types: files, redeemable codes, secure access links, service bookings, manually fulfilled goods.
- On verified paid event: transactional outbox -> worker -> fulfillment idempotency key (organization/order/item/version) -> authorized time-limited link/code -> messaging.
- Separate payment, fulfillment and message state. On failure retry safely, notify operator and provide manual recovery. Retain delivery audit.
- Generate receipt/appropriate fiscal invoice based on organization legal settings; don't claim legal tax invoice compliance until verified locally; integrate certified invoicing service when required.
- Thank-you text, customer support instructions, order and receipt identifiers. Allow templates per organization.

### 4. AI sales and customer negotiation
- Ground catalog answers in company data, not hallucinated products/prices/stock; propose discounts only within authorized price floor/budget; approval for exceptions.
- Lead qualification, product comparison, quotes, follow-up after customer opt-in, human handoff with conversation history.
- AI tool permissions per role and tenant; financial actions default human approval. Log tool request, authorized actor, result, correlation ID and failures.
- Prevent agent from executing instructions received in untrusted attachments, proofs or user messages as privileged commands.

### 5. Scheduling and automations
- Triggers: inbound message, product inquiry, order created, verified payment, manual approval, new group member, scheduled time, lead status.
- Actions: reply, send catalog, create order, request payment, notify reviewer, send secure deliverable, create receipt, update CRM, schedule followup, moderate group with permission check.
- Queue BullMQ/Redis backed by PostgreSQL persisted run status and outbox. Retry with backoff; dead-letter, dashboard replay and single-execution business idempotency keys. Workers must enforce organization scope again.
- Timezone per organization, scheduled campaign consent checks, audit events and no duplicate job dispatch.

## Proposed schema extension (design only)
organizations, organization_members, organization_integrations, organization_approvers,
products, product_assets, orders, order_items, payment_intents, payment_proofs,
payment_reviews, payment_events, fulfillments, deliveries, fiscal_documents,
catalogs, customer_conversations, quotes, group_rules, group_violations,
workflows, workflow_runs, outbox_events, audit_logs.
Use composite unique indexes scoped by organization_id. All tenant tables have RLS and backend authorization. Keep legacy user_id tables until an explicit audited data migration.

## Acceptance tests (required before release)
1. Tenant A cannot read/write tenant B's products, payments, files, conversations, groups, agents, jobs even with guessed UUIDs.
2. Two reviewers approving the same proof concurrently produce one paid transition, one fulfillment.
3. Forged or duplicate gateway webhook cannot mark paid or trigger duplicate delivery.
4. Proof rejected -> no delivery; AI OCR match alone -> no delivery.
5. Payment approved but worker crashes -> resumed delivery once; failed notification can retry independently.
6. Group non-admin connection -> unsupported remove/delete fails visibly, never claims success.
7. AI cannot grant discount beyond floor or issue refund without authorized human action.
8. Messages and campaigns respect WhatsApp integration limits, permissions and applicable consent.
9. Operator configures verified approver contact; another tenant cannot change it.
10. Fiscal document creation supports local compliance workflow; receipt is never mislabeled as a certified tax invoice.

## First engineering milestone
- Add isolated organizations/membership model, migrations and cross-tenant API tests.
- Add payment-proof review state machine with approval audit and idempotent outbox (test-mode provider, no live funds).
- Add catalog and secure deliverable storage, then WhatsApp adapter and group moderation.
- Deployment only after backups, smoke tests, and a reviewed migration plan.
