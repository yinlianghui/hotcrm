// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Dashboard } from '@objectstack/spec/ui';

/**
 * Field Service Dashboard — REQ-0002.
 *
 * The service supervisor's board: how much work is open, how much of it is
 * chargeable, whether response promises are being kept, and what the installed
 * base looks like underneath it all.
 *
 * NO `dateRange`, deliberately — the same decision (and the same cause) as
 * `service.dashboard.ts`. Every date field on `crm_work_order` that would make
 * a sensible window (`scheduled_start`, `response_due_date`, `completed_date`)
 * is a `Field.datetime()`, and on the SQLite path `driver-sql` 16.1.0 coerces
 * datetime filter values to epoch-millisecond INTEGERs while the column holds
 * ISO TEXT. SQLite orders every INTEGER before every TEXT, so a `$lte` upper
 * bound matches nothing and the runtime ANDs that range into every widget —
 * zeroing the whole dashboard. Widening the preset cannot fix it; both
 * objectstack#3912 and #3777 must land first. A dashboard that renders without
 * a date picker beats a dashboard with a picker that renders zeros.
 */
export const FieldServiceDashboard: Dashboard = {
  name: 'field_service_dashboard',
  label: 'Field Service',
  description: 'Dispatch load, response SLA, billable visits and installed-base coverage',

  columns: 12,
  gap: 4,
  refreshInterval: 60, // dispatch decisions are made on the minute

  header: {
    showTitle: true,
    showDescription: true,
  },

  globalFilters: [
    {
      field: 'assigned_engineer',
      label: 'Engineer',
      type: 'lookup',
      scope: 'dashboard',
      optionsFrom: { object: 'sys_user', valueField: 'id', labelField: 'name' },
    },
    {
      field: 'priority',
      label: 'Priority',
      type: 'select',
      scope: 'dashboard',
      options: [
        { value: 'critical', label: 'Critical' },
        { value: 'high',     label: 'High' },
        { value: 'medium',   label: 'Medium' },
        { value: 'low',      label: 'Low' },
      ],
    },
  ],

  widgets: [
    // ─── Row 1: The four numbers a supervisor opens the day with ──────
    {
      id: 'open_work_orders',
      title: 'Open Work Orders',
      description: 'Visits not yet closed or cancelled',
      type: 'metric',
      filter: { is_closed: false },
      colorVariant: 'blue',
      dataset: 'work_order_metrics', values: ['work_order_count'],
      layout: { x: 0, y: 0, w: 3, h: 2 },
      options: { icon: 'ClipboardList', format: '0,0' },
    },
    {
      id: 'response_breaches',
      title: 'Response Breaches',
      description: 'Work orders that passed their response deadline unanswered',
      type: 'metric',
      filter: { is_sla_violated: true },
      colorVariant: 'danger',
      dataset: 'work_order_metrics', values: ['work_order_count'],
      layout: { x: 3, y: 0, w: 3, h: 2 },
      options: { icon: 'ShieldAlert', format: '0,0' },
    },
    {
      id: 'billable_visits',
      title: 'Billable Visits',
      description: 'Out-of-warranty visits — chargeable to the customer',
      type: 'metric',
      filter: { is_billable: true, is_closed: false },
      colorVariant: 'warning',
      dataset: 'work_order_metrics', values: ['work_order_count'],
      layout: { x: 6, y: 0, w: 3, h: 2 },
      options: { icon: 'BadgeDollarSign', format: '0,0' },
    },
    {
      id: 'avg_field_csat',
      title: 'Avg Satisfaction',
      description: 'Mean post-visit rating (1-5)',
      type: 'metric',
      filter: { status: 'closed' },
      colorVariant: 'success',
      dataset: 'work_order_metrics', values: ['avg_rating'],
      layout: { x: 9, y: 0, w: 3, h: 2 },
      options: { icon: 'Star', format: '0.0', suffix: '/5' },
    },

    // ─── Row 2: Where the work sits ───────────────────────────────────
    {
      id: 'work_orders_by_status',
      title: 'Work Orders by Status',
      description: 'Open pipeline from intake through completion',
      type: 'donut',
      filter: { is_closed: false },
      colorVariant: 'blue',
      dataset: 'work_order_metrics', dimensions: ['status'], values: ['work_order_count'],
      layout: { x: 0, y: 2, w: 4, h: 4 },
      chartConfig: {
        type: 'donut',
        showLegend: true,
        showDataLabels: true,
        colors: ['#0EA5E9', '#6366F1', '#8B5CF6', '#F59E0B', '#14B8A6', '#10B981'],
      },
    },
    {
      id: 'work_orders_by_priority',
      title: 'Open Work by Priority',
      description: 'Urgency mix of everything still open',
      type: 'pie',
      filter: { is_closed: false },
      colorVariant: 'warning',
      dataset: 'work_order_metrics', dimensions: ['priority'], values: ['work_order_count'],
      layout: { x: 4, y: 2, w: 4, h: 4 },
      chartConfig: {
        type: 'pie',
        showLegend: true,
        showDataLabels: true,
        // critical → high → medium → low
        colors: ['#DC2626', '#F97316', '#EAB308', '#94A3B8'],
      },
    },
    {
      id: 'work_orders_by_type',
      title: 'Work by Type',
      description: 'Repair vs planned maintenance vs installation',
      type: 'bar',
      colorVariant: 'purple',
      dataset: 'work_order_metrics', dimensions: ['type'], values: ['work_order_count'],
      layout: { x: 8, y: 2, w: 4, h: 4 },
      chartConfig: {
        type: 'bar',
        showLegend: false,
        showDataLabels: true,
        colors: ['#8B5CF6'],
        xAxis: { field: 'type', title: 'Work type', showGridLines: false, logarithmic: false },
        yAxis: [{ field: 'work_order_count', title: 'Work orders', showGridLines: true, logarithmic: false }],
      },
    },

    // ─── Row 3: The installed base underneath ─────────────────────────
    {
      id: 'assets_by_status',
      title: 'Installed Base by Status',
      description: 'How much equipment is running, and how much is down',
      type: 'bar',
      // The dashboard's global filters describe a WORK ORDER (an engineer, an
      // urgency). An asset has neither, and an inherited filter naming a field
      // the object does not have is a hard validation error — so these two
      // widgets opt out explicitly. They show the installed base as it is,
      // which is the right reading: filtering the fleet by "who is on call
      // today" would be meaningless.
      filterBindings: { assigned_engineer: false, priority: false },
      colorVariant: 'blue',
      dataset: 'asset_metrics', dimensions: ['status'], values: ['asset_count'],
      layout: { x: 0, y: 6, w: 6, h: 4 },
      chartConfig: {
        type: 'bar',
        showLegend: false,
        showDataLabels: true,
        colors: ['#0EA5E9'],
        xAxis: { field: 'status', title: 'Asset status', showGridLines: false, logarithmic: false },
        yAxis: [{ field: 'asset_count', title: 'Assets', showGridLines: true, logarithmic: false }],
      },
    },
    {
      id: 'assets_by_coverage',
      title: 'Warranty Coverage',
      description: 'Installed units still covered vs chargeable',
      type: 'donut',
      // Same opt-out as the widget above — see the note there.
      filterBindings: { assigned_engineer: false, priority: false },
      colorVariant: 'success',
      dataset: 'asset_metrics', dimensions: ['is_under_warranty'], values: ['asset_count'],
      layout: { x: 6, y: 6, w: 6, h: 4 },
      chartConfig: {
        type: 'donut',
        showLegend: true,
        showDataLabels: true,
        colors: ['#10B981', '#DC2626'],
      },
    },

    // ─── Row 4: The billing picture ───────────────────────────────────
    // A dashboard `table` binds to the semantic layer and AGGREGATES; it cannot
    // list individual work orders (ADR-0021). For a per-engineer queue use the
    // `my_work_orders` ListView — the analytics path resolves no user token, so
    // a "mine" filter here would render 0 for everyone (proven and written up
    // in `src/apps/crm.app.ts`).
    {
      id: 'billing_by_warranty_status',
      title: 'Visits and Revenue by Warranty Status',
      description: 'What we fix for free, what we charge for, and what that is worth',
      type: 'table',
      colorVariant: 'default',
      dataset: 'work_order_metrics',
      dimensions: ['warranty_status'],
      values: ['work_order_count', 'total_service_charge', 'avg_labor_hours'],
      layout: { x: 0, y: 10, w: 12, h: 4 },
      options: {
        columns: [
          { header: 'Warranty Status', accessorKey: 'warranty_status' },
          { header: 'Visits',          accessorKey: 'work_order_count' },
          { header: 'Service Revenue', accessorKey: 'total_service_charge', format: '0,0' },
          { header: 'Avg Labor (h)',   accessorKey: 'avg_labor_hours', format: '0.0' },
        ],
        sortBy: 'work_order_count',
        sortOrder: 'desc',
        limit: 10,
        striped: true,
        density: 'comfortable',
      },
    },
  ],
};
