// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineView } from '@objectstack/spec/ui';

/**
 * Work Order Views — REQ-0002.
 *
 * The dispatch surfaces the customer asked for ("谁哪天有空、一天跑几家，要能
 * 在日历上排出来"):
 *
 *   • calendar `dispatch_calendar` — every scheduled visit on one calendar,
 *     coloured by urgency. This is the board dispatch works from.
 *   • timeline `engineer_schedule` — the same visits laid out as one lane PER
 *     ENGINEER, which is what answers "who is free on Thursday, and how many
 *     calls is this person already doing that day".
 *
 * Neither needs a date WINDOW, which is what keeps them clear of the datetime
 * range-filter defect documented in `src/dashboards/service.dashboard.ts`. They
 * do differ in what they bind: the calendar reads the datetime
 * `scheduled_start` happily, while the timeline groups lanes by a DATE and
 * reads a datetime as no date at all — so it binds the derived
 * `scheduled_date` instead (see the field comment on the schema).
 */
export const WorkOrderViews = defineView({
  list: {
    type: 'grid',
    name: 'all_work_orders',
    label: 'All Work Orders',
    data: { provider: 'object', object: 'crm_work_order' },
    columns: [
      { field: 'work_order_number', width: 130, sortable: true, link: true, pinned: 'left' },
      { field: 'subject', width: 240, sortable: true },
      { field: 'crm_account', width: 170 },
      { field: 'crm_asset', width: 170 },
      { field: 'priority', width: 110, sortable: true },
      { field: 'status', width: 130, sortable: true },
      { field: 'assigned_engineer', width: 160 },
      { field: 'scheduled_start', width: 165, sortable: true },
      { field: 'response_due_date', width: 165, sortable: true },
      { field: 'is_billable', width: 110, align: 'center' },
      { field: 'is_sla_violated', width: 110, align: 'center' },
      { field: 'has_schedule_conflict', width: 120, align: 'center' },
    ],
    // Sort on the materialised ordinal, never on `priority` itself: comparing
    // the raw select strings lands medium > low > high > critical and buries
    // every critical job at the bottom of the queue (the lesson `crm_case`
    // paid for; pinned by `test/metadata-references.test.ts`).
    sort: [
      { field: 'priority_rank', order: 'desc' },
      { field: 'response_due_date', order: 'asc' },
    ],
    rowColor: {
      field: 'priority',
      colors: { critical: '#dc2626', high: '#f97316', medium: '#eab308', low: '#94a3b8' },
    },
    selection: { type: 'multiple' },
    pagination: { pageSize: 50 },
    exportOptions: ['csv', 'xlsx'],
    appearance: {
      showDescription: true,
      allowedVisualizations: ['grid', 'kanban', 'calendar', 'timeline'],
    },
    tabs: [
      { name: 'all', label: 'All', view: 'all_work_orders', isDefault: true, pinned: true },
      { name: 'board', label: 'Board', icon: 'columns-3', view: 'work_order_board' },
      { name: 'dispatch', label: 'Dispatch Calendar', icon: 'calendar-clock', view: 'dispatch_calendar' },
      { name: 'engineers', label: 'Engineer Schedule', icon: 'users', view: 'engineer_schedule' },
      { name: 'unassigned', label: 'Unassigned', icon: 'user-x', view: 'unassigned_work_orders' },
      { name: 'at_risk', label: 'Response at Risk', icon: 'clock-alert', view: 'work_orders_response_at_risk' },
      { name: 'billable', label: 'Billable', icon: 'badge-dollar-sign', view: 'billable_work_orders' },
      { name: 'mine', label: 'My Jobs', icon: 'user', view: 'my_work_orders' },
    ],
    // No `rowActions`: the legacy surface only dispatches defined stack
    // actions, and row edit is built in ('edit' is not a defined action).
  },

  listViews: {
    /** Service workflow board */
    work_order_board: {
      name: 'work_order_board',
      type: 'kanban',
      label: 'Work Order Board',
      data: { provider: 'object', object: 'crm_work_order' },
      columns: ['work_order_number', 'subject', 'priority', 'scheduled_start'],
      kanban: {
        groupByField: 'status',
        columns: ['work_order_number', 'subject', 'crm_account', 'priority', 'assigned_engineer'],
      },
      filter: [{ field: 'is_closed', operator: 'equals', value: false }],
      navigation: { mode: 'drawer', width: '680px' },
    },

    /** The dispatch board — every scheduled visit, coloured by urgency */
    dispatch_calendar: {
      name: 'dispatch_calendar',
      type: 'calendar',
      label: 'Dispatch Calendar',
      data: { provider: 'object', object: 'crm_work_order' },
      columns: ['work_order_number', 'subject', 'crm_account', 'assigned_engineer'],
      calendar: {
        startDateField: 'scheduled_start',
        endDateField: 'scheduled_end',
        titleField: 'subject',
        colorField: 'priority',
      },
    },

    /**
     * Per-engineer capacity — the "谁哪天有空、一天跑几家" question.
     *
     * A GROUPED GRID rather than the timeline this started as, and the reason is
     * measured, not stylistic: the 16.1.0 timeline renderer does not read
     * `timeline.startDateField` at all. Bound to `scheduled_start` (datetime) it
     * put all six visits in one "no date" lane; bound to the derived
     * `scheduled_date` — a real `Field.date()`, confirmed present and populated
     * in the view's own API response — it did exactly the same. The app's one
     * working timeline (`task_timeline`) only appears to work because
     * `crm_task` happens to carry the field names the renderer looks for; the
     * shipped `case_timeline` collapses the same way this one did.
     *
     * A grouped grid answers the question today: one section per engineer,
     * their visits in date order, with the double-booking flag visible. The
     * timeline stays available from the visualization switcher for whenever the
     * renderer starts honouring the binding.
     */
    engineer_schedule: {
      name: 'engineer_schedule',
      type: 'grid',
      label: 'Engineer Schedule',
      data: { provider: 'object', object: 'crm_work_order' },
      columns: [
        // `assigned_engineer` must be a COLUMN as well as the grouping field:
        // the grid builds its `select` from `columns` only, so grouping on a
        // field that is not listed fetches nothing and every row lands in a
        // single "(empty)" group. Measured on 16.1.0 — the request went out as
        // `select=id,scheduled_date,work_order_number,…` with no engineer in it.
        { field: 'assigned_engineer', width: 160 },
        { field: 'scheduled_date', width: 140, sortable: true },
        { field: 'work_order_number', width: 130, link: true },
        { field: 'subject', width: 240 },
        { field: 'crm_account', width: 170 },
        { field: 'priority', width: 110 },
        { field: 'status', width: 130 },
        { field: 'has_schedule_conflict', width: 120, align: 'center' },
      ],
      grouping: { fields: [{ field: 'assigned_engineer', order: 'asc', collapsed: false }] },
      filter: [{ field: 'is_closed', operator: 'equals', value: false }],
      sort: [{ field: 'scheduled_date', order: 'asc' }],
    },

    /** Nobody is going yet — the dispatcher's inbox */
    unassigned_work_orders: {
      name: 'unassigned_work_orders',
      type: 'grid',
      label: '📥 Awaiting Dispatch',
      data: { provider: 'object', object: 'crm_work_order' },
      columns: ['work_order_number', 'subject', 'crm_account', 'crm_asset', 'priority', 'response_due_date', 'is_billable'],
      filter: [
        { field: 'assigned_engineer', operator: 'is_null' },
        { field: 'is_closed', operator: 'equals', value: false },
      ],
      sort: [
        { field: 'priority_rank', order: 'desc' },
        { field: 'response_due_date', order: 'asc' },
      ],
    },

    /**
     * Response-at-risk queue. Operator-only filter: the view runtime does not
     * interpolate `{NOW() + 4h}`, so this is "open, urgent, soonest deadline
     * first" — the actionable ordering — rather than a strictly-breached list.
     * The strictly-breached set is what `work_order_sla_monitor` stamps onto
     * `is_sla_violated` hourly.
     */
    work_orders_response_at_risk: {
      name: 'work_orders_response_at_risk',
      type: 'grid',
      label: '⏰ Response at Risk',
      data: { provider: 'object', object: 'crm_work_order' },
      columns: ['work_order_number', 'subject', 'crm_account', 'priority', 'response_due_date', 'assigned_engineer', 'owner'],
      filter: [
        { field: 'is_closed', operator: 'equals', value: false },
        { field: 'responded_date', operator: 'is_null' },
      ],
      sort: [
        { field: 'priority_rank', order: 'desc' },
        { field: 'response_due_date', order: 'asc' },
      ],
    },

    /** Chargeable visits — the ones dispatch must flag to the customer first */
    billable_work_orders: {
      name: 'billable_work_orders',
      type: 'grid',
      label: '💰 Billable Visits',
      data: { provider: 'object', object: 'crm_work_order' },
      columns: ['work_order_number', 'subject', 'crm_account', 'crm_asset', 'warranty_status', 'service_charge', 'status', 'assigned_engineer'],
      filter: [{ field: 'is_billable', operator: 'equals', value: true }],
      sort: [{ field: 'scheduled_start', order: 'desc' }],
    },

    /**
     * The engineer's own day. Keyed on `assigned_engineer`, NOT `owner` —
     * `owner` is the supervisor accountable for the SLA, the engineer is who
     * drives out. This is a LIST view because the list data path is the only
     * surface where `{current_user_id}` actually resolves (the analytics path
     * does not — see the note in `src/apps/crm.app.ts`).
     */
    my_work_orders: {
      name: 'my_work_orders',
      type: 'grid',
      label: 'My Work Orders',
      data: { provider: 'object', object: 'crm_work_order' },
      columns: ['work_order_number', 'subject', 'crm_account', 'crm_asset', 'priority', 'status', 'scheduled_start', 'is_billable'],
      filter: [
        { field: 'assigned_engineer', operator: 'equals', value: '{current_user_id}' },
        { field: 'is_closed', operator: 'equals', value: false },
      ],
      sort: [{ field: 'scheduled_start', order: 'asc' }],
    },
  },

  form: {
    type: 'tabbed',
    sections: [
      {
        label: 'Work Order',
        columns: 2,
        fields: [
          'work_order_number',
          { field: 'subject', required: true, colSpan: 2 },
          { field: 'crm_account', required: true },
          'crm_contact',
          'crm_asset',
          'crm_case',
          'type',
          'origin',
          { field: 'status', required: true },
          { field: 'priority', required: true },
          { field: 'description', required: true, colSpan: 2 },
        ],
      },
      {
        label: 'Dispatch',
        columns: 2,
        fields: [
          'assigned_engineer',
          'owner',
          'scheduled_start',
          'scheduled_end',
          'scheduled_date',
          'has_schedule_conflict',
          { field: 'service_address', colSpan: 2 },
          'response_due_date',
          'responded_date',
          'is_sla_violated',
        ],
      },
      {
        // Deliberately its own tab and not buried in Dispatch: this is the
        // "派单前系统要提醒这单是收费单" surface — the money question has to be
        // answerable before anyone is sent.
        label: 'Warranty & Billing',
        columns: 2,
        fields: ['warranty_status', 'is_billable', 'service_charge'],
      },
      {
        label: 'Completion',
        columns: 2,
        fields: [
          { field: 'work_performed', colSpan: 2 },
          { field: 'parts_used', colSpan: 2 },
          'labor_hours',
          'completed_date',
          'signed_by',
          'signed_date',
          { field: 'customer_signature', colSpan: 2 },
        ],
      },
      {
        label: 'Feedback',
        columns: 1,
        fields: ['customer_rating', 'customer_feedback', 'internal_notes', 'is_closed'],
      },
    ],
  },
});
