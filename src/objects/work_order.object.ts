import { F, P, cel } from '@objectstack/spec';
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * Work Order — the on-site visit (REQ-0002).
 *
 * A `crm_case` is a CONVERSATION: someone reported something, someone answers.
 * A work order is a VISIT: an engineer goes to a site, at a time, does work,
 * and gets a signature. The two are linked (`crm_case` below) precisely so the
 * support desk keys the report once and hands it to dispatch.
 *
 * Three things are deliberately materialised as real columns rather than
 * formulas, because every one of them is filtered or sorted on by a queue view
 * and formula fields cannot be query predicates in this app (ADR-0072):
 *
 *   • `priority_rank`  — sorting by the `priority` SELECT compares raw strings
 *     and lands medium > low > high > critical, i.e. the exact inversion of
 *     urgency. The same trap `crm_case` fell into; pinned by
 *     `test/metadata-references.test.ts`.
 *   • `warranty_status` / `is_billable` — resolved FROM THE ASSET at save time,
 *     not read live at dispatch. The customer's ask is that the charge is
 *     visible *before* anyone is sent ("派单前系统要提醒这单是收费单"), and a
 *     value you can see on the record is what makes that possible.
 *   • `is_closed` — the flag every open-queue view filters on.
 *
 * Scope: ONE visit per work order (REQ-0002 defers multi-visit jobs and
 * multi-engineer crews). `scheduled_start`/`scheduled_end` are therefore the
 * appointment itself, which is what the dispatch calendar renders.
 */
export const WorkOrder = ObjectSchema.create({
  name: 'crm_work_order',
  label: 'Work Order',
  pluralLabel: 'Work Orders',
  icon: 'wrench',
  description: 'On-site service visit against an installed asset',

  // ADR-0090 D1/D7: OWD is an authored decision. `private` — a work order is
  // owned by the service supervisor who is accountable for its SLA, and that
  // ownership is what the breach notification addresses. Dispatchers and
  // engineers reach other people's work orders through their permission set
  // (`service_agent` holds org-wide view/modify; `field_engineer` holds it
  // narrowed by a row-level policy to the jobs assigned to them), NOT by
  // widening the baseline for everyone.
  sharingModel: 'private',

  // ADR-0079: `nameField` names a real field, so the composed record title
  // lives in a formula field.
  nameField: 'display_title',
  // Explicit search targets (ADR-0061) — REQUIRED because `nameField` is a
  // formula, which is not a real column.
  searchableFields: ['subject', 'work_order_number'],
  highlightFields: ['work_order_number', 'subject', 'crm_account', 'status', 'priority', 'assigned_engineer'],

  fieldGroups: [
    { key: 'basic',      label: 'Work Order',        icon: 'info' },
    { key: 'sla',        label: 'Priority & Response', icon: 'clock' },
    { key: 'dispatch',   label: 'Dispatch & Schedule', icon: 'calendar-clock' },
    { key: 'billing',    label: 'Warranty & Billing',  icon: 'badge-dollar-sign' },
    { key: 'completion', label: 'On-Site Completion',  icon: 'clipboard-check' },
    { key: 'feedback',   label: 'Customer Feedback',   icon: 'star' },
    { key: 'system',     label: 'System',              icon: 'database', defaultExpanded: false },
  ],

  fields: {
    work_order_number: Field.autonumber({
      label: 'Work Order Number',
      group: 'basic',
      format: 'WO-{00000}',
    }),

    subject: Field.text({
      label: 'Subject',
      group: 'basic',
      required: true,
      searchable: true,
      maxLength: 255,
    }),

    display_title: Field.formula({
      label: 'Display Title',
      group: 'basic',
      expression: F`record.work_order_number + " - " + record.subject`,
    }),

    description: Field.markdown({
      label: 'Reported Problem',
      group: 'basic',
      required: true,
      description: 'What the customer reported, in their words',
    }),

    // ─── What and who ─────────────────────────────────────────────────
    crm_account: Field.lookup('crm_account', {
      label: 'Account',
      group: 'basic',
      required: true,
    }),

    crm_contact: Field.lookup('crm_contact', {
      label: 'Site Contact',
      group: 'basic',
      // Cascading lookup (ADR-0049) — contacts of this work order's account.
      dependsOn: ['crm_account'],
    }),

    // Optional on purpose: a first visit can be raised before the machine is
    // identified (or for a site that has no asset record yet). When it IS set,
    // it is what drives the warranty/billing resolution below.
    crm_asset: Field.lookup('crm_asset', {
      label: 'Asset',
      group: 'basic',
      dependsOn: ['crm_account'],
      description: 'The installed unit being serviced',
    }),

    // The support-desk hand-off. Set by the `create_work_order` action so the
    // agent who took the phone call does not re-key anything.
    crm_case: Field.lookup('crm_case', {
      label: 'Originating Case',
      group: 'basic',
      description: 'The support case this visit was raised from',
    }),

    type: Field.select({
      label: 'Work Type',
      group: 'basic',
      options: [
        { label: 'Repair', value: 'repair', default: true },
        { label: 'Preventive Maintenance', value: 'maintenance' },
        { label: 'Installation', value: 'installation' },
        { label: 'Inspection', value: 'inspection' },
      ],
    }),

    origin: Field.select({
      label: 'Reported Via',
      group: 'basic',
      options: [
        { label: 'Phone', value: 'phone' },
        { label: 'Email', value: 'email' },
        { label: 'Support Case', value: 'case' },
        { label: 'Customer Portal', value: 'portal' },
        // Chat channels are recorded here; the CHANNEL INTEGRATION itself
        // (e.g. a WeChat group bot) is a customer overlay, not core — see
        // REQ-0002's C carve-out.
        { label: 'Chat / IM', value: 'chat' },
        { label: 'Proactive / Scheduled', value: 'proactive' },
      ],
    }),

    status: Field.select({
      label: 'Status',
      group: 'basic',
      required: true,
      // ADR-0052 §5b.1 — the platform renders status changes on the timeline.
      trackHistory: true,
      options: [
        { label: 'New', value: 'new', color: '#808080', default: true },
        { label: 'Scheduled', value: 'scheduled', color: '#4169E1' },
        { label: 'Dispatched', value: 'dispatched', color: '#9370DB' },
        { label: 'In Progress', value: 'in_progress', color: '#FFA500' },
        { label: 'On Hold', value: 'on_hold', color: '#FFD700' },
        { label: 'Completed', value: 'completed', color: '#00AA00' },
        { label: 'Closed', value: 'closed', color: '#006400' },
        { label: 'Cancelled', value: 'cancelled', color: '#666666' },
      ],
    }),

    // ─── Priority & response SLA ──────────────────────────────────────
    // The customer's two tiers ("紧急 4 小时 / 普通 当天") generalise to the
    // same four-value vocabulary `crm_case` uses, so a supervisor reads one
    // scale across the whole service domain. The hour mapping lives in
    // `work_order.hook.ts`: critical 4h, high 8h, medium 24h (same day),
    // low 72h.
    priority: Field.select({
      label: 'Priority',
      group: 'sla',
      required: true,
      trackHistory: true,
      options: [
        { label: 'Low', value: 'low', color: '#94A3B8' },
        { label: 'Medium', value: 'medium', color: '#EAB308', default: true },
        { label: 'High', value: 'high', color: '#F97316' },
        { label: 'Critical', value: 'critical', color: '#DC2626' },
      ],
    }),

    // Sortable ordinal for `priority` — see the class comment. Stamped by
    // `work_order_defaults`; every queue view sorts on this, never on the
    // select itself.
    priority_rank: Field.number({
      label: 'Priority Rank',
      group: 'sla',
      readonly: true,
      defaultValue: 2,
    }),

    // The promise: someone responds by this moment. Stamped from `priority` on
    // insert unless dispatch overrides it.
    response_due_date: Field.datetime({
      label: 'Response Due',
      group: 'sla',
    }),

    // When someone actually picked it up (first move out of `new`).
    responded_date: Field.datetime({
      label: 'Responded At',
      group: 'sla',
    }),

    // NOT `readonly`: written by the `work_order_sla_monitor` flow, and 16.x
    // drops readonly writes from flow `update_record` nodes (#2948) — readonly
    // here would silently disable breach tracking, exactly as it did on
    // `crm_case.is_sla_violated`.
    is_sla_violated: Field.boolean({
      label: 'Response SLA Breached',
      group: 'sla',
      defaultValue: false,
    }),

    // ─── Dispatch ─────────────────────────────────────────────────────
    assigned_engineer: Field.lookup('sys_user', {
      label: 'Field Engineer',
      group: 'dispatch',
      trackHistory: true,
      description: 'Who goes on site',
    }),

    scheduled_start: Field.datetime({
      label: 'Scheduled Start',
      group: 'dispatch',
    }),

    scheduled_end: Field.datetime({
      label: 'Scheduled End',
      group: 'dispatch',
    }),

    /**
     * The calendar DAY of the visit, derived from `scheduled_start`.
     *
     * Not redundant — load-bearing. The timeline renderer groups its lanes by a
     * `Field.date()` and reads a `Field.datetime()` as no date at all: every
     * record lands in a single "no date" bucket, which is exactly how the
     * shipped `case_timeline` (bound to the datetime `created_date`) renders
     * today. Measured side by side on 16.1.0: `task_timeline` (date fields)
     * groups into Today / Tomorrow / Next week; both datetime-bound timelines
     * collapse. So the engineer-schedule lanes bind to this column instead.
     *
     * It is also the safe column to filter and group on: dates stay TEXT
     * `YYYY-MM-DD` on both sides of a comparison, which is what the datetime
     * columns cannot currently promise on the SQLite path (see
     * `src/dashboards/service.dashboard.ts`).
     *
     * NOT `readonly`: derived by `work_order_defaults` on every save, and seed
     * rows supply it directly (their `scheduled_start` is still an unresolved
     * expression when hooks run, so it cannot be derived at that point).
     */
    scheduled_date: Field.date({
      label: 'Scheduled Date',
      group: 'dispatch',
      description: 'The day of the visit — derived from Scheduled Start',
    }),

    // Set by `work_order_defaults` when this engineer already has an
    // overlapping visit. A flag rather than a hard error on purpose: dispatch
    // sometimes double-books knowingly (two jobs on one industrial park), and a
    // blocking validation would just get worked around by clearing the
    // engineer. Surfaced as a column on the dispatch board.
    has_schedule_conflict: Field.boolean({
      label: 'Schedule Conflict',
      group: 'dispatch',
      defaultValue: false,
    }),

    service_address: Field.address({
      label: 'Service Address',
      group: 'dispatch',
      description: 'Defaults from the asset site when left empty',
    }),

    // ─── Warranty & billing ───────────────────────────────────────────
    // Resolved from `crm_asset` on every save (see the class comment).
    warranty_status: Field.select({
      label: 'Warranty Status',
      group: 'billing',
      options: [
        { label: 'Under Warranty', value: 'under_warranty', color: '#00AA00' },
        { label: 'Out of Warranty', value: 'out_of_warranty', color: '#DC2626' },
        { label: 'Unknown', value: 'unknown', color: '#94A3B8', default: true },
      ],
    }),

    is_billable: Field.boolean({
      label: 'Billable Visit',
      group: 'billing',
      defaultValue: false,
      description: 'Out-of-warranty visits are chargeable — check before dispatching',
    }),

    service_charge: Field.currency({
      label: 'Service Charge',
      group: 'billing',
      scale: 2,
      min: 0,
    }),

    // ─── On-site completion ───────────────────────────────────────────
    work_performed: Field.markdown({
      label: 'Work Performed',
      group: 'completion',
      description: 'What the engineer actually did on site',
    }),

    // Free text by design in v1 — consuming stock against `crm_product` is a
    // deferred (D) item on REQ-0002.
    parts_used: Field.textarea({
      label: 'Parts Used',
      group: 'completion',
    }),

    labor_hours: Field.number({
      label: 'Labor Hours',
      group: 'completion',
      scale: 1,
      min: 0,
    }),

    completed_date: Field.datetime({
      label: 'Completed At',
      group: 'completion',
    }),

    customer_signature: Field.signature({
      label: 'Customer Signature',
      group: 'completion',
      description: 'On-site acceptance of the work performed',
    }),

    signed_by: Field.text({
      label: 'Signed By',
      group: 'completion',
      maxLength: 255,
      description: 'Name of the person at the site who accepted the work',
    }),

    signed_date: Field.datetime({
      label: 'Signed At',
      group: 'completion',
    }),

    // ─── Feedback ─────────────────────────────────────────────────────
    customer_rating: Field.rating(5, {
      label: 'Customer Satisfaction',
      group: 'feedback',
      description: 'Collected on the post-visit call-back (1-5 stars)',
    }),

    customer_feedback: Field.textarea({
      label: 'Customer Feedback',
      group: 'feedback',
    }),

    // ─── System ───────────────────────────────────────────────────────
    // The service supervisor accountable for this job. SLA breach alerts are
    // addressed here — which is why it is NOT the engineer.
    owner: Field.lookup('sys_user', {
      defaultValue: cel`os.user.id`,
      label: 'Service Supervisor',
      group: 'system',
      trackHistory: true,
    }),

    is_closed: Field.boolean({
      label: 'Is Closed',
      group: 'system',
      defaultValue: false,
      readonly: true,
    }),

    internal_notes: Field.markdown({
      label: 'Internal Notes',
      group: 'system',
      description: 'Dispatch notes not shown to the customer',
    }),
  },

  // Tenant composite for the autonumber, for the same per-tenant sequence
  // reason documented on `crm_case` / `crm_asset` (framework #3696).
  indexes: [
    { fields: ['organization_id', 'work_order_number'], unique: true },
    { fields: ['crm_account'] },
    { fields: ['crm_asset'] },
    { fields: ['crm_case'] },
    { fields: ['assigned_engineer'] },
    { fields: ['status'] },
    { fields: ['scheduled_start'] },
  ],

  enable: {
    apiEnabled: true,
    apiMethods: ['get', 'list', 'create', 'update', 'delete'],
  },

  activityMilestones: [
    { field: 'status', value: 'dispatched', summary: 'Engineer dispatched — {subject}', type: 'updated' },
    { field: 'status', value: 'completed', summary: 'Work completed on site — {subject}', type: 'completed' },
    { field: 'status', value: 'closed', summary: 'Work order closed — {subject}', type: 'completed' },
  ],

  validations: [
    {
      name: 'engineer_required_for_dispatch',
      type: 'script',
      severity: 'error',
      message: 'Assign a field engineer before dispatching this work order',
      condition: P`has(record.status) && (record.status == "dispatched" || record.status == "in_progress") && (!has(record.assigned_engineer) || isBlank(record.assigned_engineer))`,
    },
    {
      name: 'schedule_required_for_dispatch',
      type: 'script',
      severity: 'error',
      message: 'Schedule the visit before dispatching this work order',
      condition: P`has(record.status) && record.status == "dispatched" && (!has(record.scheduled_start) || record.scheduled_start == null)`,
    },
    {
      // Both operands carry their own `!= null` guard in the SAME expression:
      // strict CEL aborts on `dyn<null> <= datetime`, which would leave the
      // rule looking enforced while never firing (see
      // `test/object-validation-predicates.test.ts`).
      name: 'scheduled_end_after_start',
      type: 'script',
      severity: 'error',
      message: 'Scheduled End must be after Scheduled Start',
      condition: P`has(record.scheduled_end) && record.scheduled_end != null && has(record.scheduled_start) && record.scheduled_start != null && record.scheduled_end <= record.scheduled_start`,
    },
    {
      name: 'work_performed_required_for_completion',
      type: 'script',
      severity: 'error',
      message: 'Record what was done on site before completing the work order',
      condition: P`has(record.status) && (record.status == "completed" || record.status == "closed") && (!has(record.work_performed) || isBlank(record.work_performed))`,
    },
    {
      // The customer's ask ("客户签字确认") as a hard rule — but on the NAME,
      // not the drawn signature. Requiring the signature image itself would
      // block completion whenever the pad is unavailable (offline van, refused
      // tablet), so the image is a warning below and the accountable name is
      // the error.
      name: 'signature_name_required_for_completion',
      type: 'script',
      severity: 'error',
      message: 'Record who at the site accepted the work',
      condition: P`has(record.status) && (record.status == "completed" || record.status == "closed") && (!has(record.signed_by) || isBlank(record.signed_by))`,
    },
    {
      name: 'customer_signature_expected_on_completion',
      type: 'script',
      severity: 'warning',
      message: 'This visit was completed without a customer signature',
      condition: P`has(record.status) && record.status == "completed" && (!has(record.customer_signature) || isBlank(record.customer_signature))`,
    },
    {
      name: 'billable_visit_needs_a_charge',
      type: 'script',
      severity: 'warning',
      message: 'This visit is out of warranty — record the service charge',
      condition: P`has(record.is_billable) && record.is_billable == true && has(record.status) && record.status == "completed" && (!has(record.service_charge) || record.service_charge == null)`,
    },
    {
      name: 'work_order_status_progression',
      type: 'state_machine',
      severity: 'warning',
      message: 'Invalid status transition',
      field: 'status',
      // Cancellation is legal from any state that has not finished; a completed
      // visit can be reopened (`in_progress`) when the customer calls back.
      transitions: {
        'new': ['scheduled', 'dispatched', 'on_hold', 'cancelled'],
        'scheduled': ['dispatched', 'in_progress', 'on_hold', 'new', 'cancelled'],
        'dispatched': ['in_progress', 'on_hold', 'scheduled', 'completed', 'cancelled'],
        'in_progress': ['completed', 'on_hold', 'cancelled'],
        'on_hold': ['scheduled', 'dispatched', 'in_progress', 'cancelled'],
        'completed': ['closed', 'in_progress'],
        'closed': ['in_progress'],
        'cancelled': ['new'],
      },
    },
  ],
});
