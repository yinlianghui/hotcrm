// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineDataset } from '@objectstack/spec/ui';

/**
 * Work-order analytics dataset (ADR-0021) — the semantic source of truth for
 * the Field Service dashboard (REQ-0002).
 *
 * No `dateGranularity` on the date dimension, for the same reason
 * `case_metrics` carries none: `scheduled_start` is a `Field.datetime()`, and
 * the SQLite path currently mis-compares datetime columns in a range filter
 * (written up in full at `src/dashboards/service.dashboard.ts`). Keeping the
 * dimension without a granularity keeps it usable as a grouping key while
 * staying clear of the windowing defect.
 */
export const WorkOrderDataset = defineDataset({
  name: 'work_order_metrics',
  label: 'Work Order Metrics',
  description: 'Semantic layer for field-service volume, response SLA, billing and satisfaction',
  object: 'crm_work_order',

  dimensions: [
    { name: 'status', label: 'Status', field: 'status', type: 'string' },
    { name: 'priority', label: 'Priority', field: 'priority', type: 'string' },
    { name: 'type', label: 'Work Type', field: 'type', type: 'string' },
    { name: 'origin', label: 'Reported Via', field: 'origin', type: 'string' },
    { name: 'warranty_status', label: 'Warranty Status', field: 'warranty_status', type: 'string' },
    { name: 'scheduled_start', label: 'Scheduled', field: 'scheduled_start', type: 'date' },
  ],

  measures: [
    { name: 'work_order_count', label: 'Work Orders', aggregate: 'count' },
    { name: 'avg_labor_hours', label: 'Avg Labor (h)', aggregate: 'avg', field: 'labor_hours', format: '0.0' },
    { name: 'total_service_charge', label: 'Service Revenue', aggregate: 'sum', field: 'service_charge', format: '0,0' },
    { name: 'avg_sla_violated', label: 'Response Breach Rate', aggregate: 'avg', field: 'is_sla_violated', format: '0.0%' },
    { name: 'avg_rating', label: 'Avg Satisfaction', aggregate: 'avg', field: 'customer_rating', format: '0.0' },
  ],
});
