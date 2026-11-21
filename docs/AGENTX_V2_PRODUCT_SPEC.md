# AgentX 2.0 — Functional contracts and delivery gates
Status: product specification. Requirements describe the target behavior. See the milestone notes for implementation and validation status.

## Product mandate
A WhatsApp sales and operations agent backed by a multi-tenant CRM. The owner configures the catalog, group rules and schedules in AgentX. The agent presents products, captures leads, closes orders and records the outcome in the platform. The owner can review what happened and take over when needed. No n8n dependency. Preserve the current production system until tests and migration pass. All company records carry organization_id. Authorize access from the authenticated session and verified membership, never from an untrusted body/AI parameter. Never expose service-role keys, secrets or unauthorized customer files to the browser.

## Core sales flow
1. The owner creates an active product in the platform with its price, availability and delivery method.
2. A customer writes on WhatsApp. AgentX links the conversation to a contact, captures or updates a lead, and uses the real catalog to answer.
3. When the customer agrees to buy, the agent creates an order with the agreed items and records the commercial commitment in the lead pipeline. The platform shows the order and the pending payment separately.
4. The owner or authorized reviewer checks the payment directly with the provider. After confirmation, the platform records one completed sale, updates the order and stock where applicable, and starts digital delivery or creates a manual fulfillment task.
5. The owner can inspect the conversation, order, payment decision and delivery state and take over the conversation from the platform.

## Functional modules
### 1. Group administration
- Per-organization WhatsApp connection and per-group rules: join greetings, anti-spam, anti-flood, disallowed links, explicit keyword rules, blocked media categories where reliable detection exists, escalation, warning threshold, optional removal/ban.
- Maintain group-specific allowlists, administrator exceptions, violation history and appeal/review; never automatically ban on AI-only uncertain classification.
- Delete messages or remove members ONLY when the linked account is a group admin and the chosen channel supports the action. Reflect API limits and failures in the UI; don't advertise unsupported actions.
- Group reports, safe rate limits and opt-in automated announcements.

### 2. Orders and manual payment confirmation
- Orders belong to organization_id and reference a specific customer and product snapshot (currency, price, tax, quantity).
- Payment takes place outside AgentX through a method configured by the owner, such as M-Pesa or bank transfer. PaySuite and automatic payment gateway integrations are out of scope. A proof or OCR result is evidence for review.
- Uploaded proof goes to private scoped storage with file limits, malware scanning where available, authorized access, and a hash to flag repeats. Store reference, amount, currency, method, payer reference, review state and timestamps.
- Notify organization-configured approvers (verified WhatsApp contact or in-app); include signed expiring dashboard link, not actionable 'reply YES' approvals.
- Manual confirmation requires session authentication, membership role 'owner'/'finance_admin', and auditable approve/reject action, with reason and order-level locking. Approver must verify settlement independently before approval.
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
- Capture and qualify a lead from a commercial conversation, associate it with the existing contact, and update its stage from quotes, order creation, and verified sales. Support product comparison, consent-based follow-ups, and human handoff with the conversation and linked order.
- AI tool permissions per role and tenant; financial actions default human approval. Log tool request, authorized actor, result, correlation ID and failures.
- Prevent agent from executing instructions received in untrusted attachments, proofs or user messages as privileged commands.

### 5. Scheduling and automations
- Triggers: inbound message, product inquiry, order created, verified payment, manual approval, new group member, scheduled time, lead status.
- Actions: reply, send catalog, create order, request payment, notify reviewer, send secure deliverable, create receipt, update CRM, schedule followup, moderate group with permission check.
- Queue BullMQ/Redis backed by PostgreSQL persisted run status and outbox. Retry with backoff; dead-letter, dashboard replay and single-execution business idempotency keys. Workers must enforce organization scope again.
- Schedule private messages, audio, reminders, recurring posts and Status. The owner controls recipients, timing and recurrence and can pause or cancel future runs. Use the organization time zone, enforce consent and WhatsApp limits, and record the outcome of each run.

## Proposed schema extension (design only)
organizations, organization_members, organization_integrations, organization_approvers,
products, product_assets, orders, order_items, payment_proofs,
payment_reviews, payment_events, fulfillments, deliveries, fiscal_documents,
catalogs, customer_conversations, quotes, group_rules, group_violations,
workflows, workflow_runs, outbox_events, audit_logs.
Use composite unique indexes scoped by organization_id. All tenant tables have RLS and backend authorization. Keep legacy user_id tables until an explicit audited data migration.

## Acceptance tests (required before release)
1. Tenant A cannot read/write tenant B's products, payments, files, conversations, groups, agents, jobs even with guessed UUIDs.
2. Two reviewers approving the same proof concurrently produce one paid transition, one fulfillment.
3. A customer agrees to buy a catalog item on WhatsApp. A linked order and lead update appear in AgentX. A completed sale appears once after the authorized owner verifies payment.
4. Proof rejected -> no delivery; AI OCR match alone -> no delivery.
5. Payment approved but worker crashes -> resumed delivery once; failed notification can retry independently.
6. Group non-admin connection -> unsupported remove/delete fails visibly, never claims success.
7. AI cannot grant discount beyond floor or issue refund without authorized human action.
8. Messages and campaigns respect WhatsApp integration limits, permissions and applicable consent.
9. Operator configures verified approver contact; another tenant cannot change it.
10. Fiscal document creation supports local compliance workflow; receipt is never mislabeled as a certified tax invoice.

## Delivery priorities
1. Validate the catalog-to-sale flow with a WhatsApp test account, including lead capture and a completed sale visible in the platform.
2. Add owner controls and status feedback for leads, approved sales, delivery failures, and human handoff.
3. Validate group management, reminders, scheduled messages, and recurring posts against WhatsApp permissions and limits.
4. Extend organization isolation across the CRM, catalog and WhatsApp connection while preserving existing production data.
