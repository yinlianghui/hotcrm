// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type * as Automation from '@objectstack/spec/automation';
type Flow = Automation.Flow;

/**
 * Work Order Response SLA Monitor — REQ-0002 ask #2.
 *
 * "超时要自动提醒到服务主管." The schema carries `response_due_date` and
 * `is_sla_violated`, but a deadline nobody watches is a deadline that quietly
 * passes — the exact failure the customer described living with in Excel
 * ("经常漏单"). This is the hourly sweep that watches it.
 *
 * The predicate is `responded_date: null`, not a status check: the promise the
 * customer makes is that someone RESPONDS within the window, and a work order
 * that has been picked up has met it even if the visit is days out.
 *
 * Deliberately the same shape as `case_sla_monitor` (scheduled trigger + `loop`
 * + `update_record` + `notify`), because it is the same promise on a different
 * object — and because that flow's two hard-won details apply verbatim:
 *   • per-record `update_record` inside a loop, never a filtered mass update
 *     (the node calls `data.update()` without `options.multi`);
 *   • `to: ['{currentWorkOrder.owner}']` — a lookup dot-walk such as
 *     `{...owner.manager}` interpolates to the literal "undefined".
 *
 * `owner` on a work order IS the service supervisor (see the field comment on
 * the schema), so addressing the owner is what satisfies the ask.
 */
export const WorkOrderSlaMonitorFlow: Flow = {
  name: 'work_order_sla_monitor',
  label: 'Work Order Response SLA Monitor',
  description: 'Hourly sweep: flag work orders whose response deadline passed unanswered and alert the service supervisor.',
  type: 'schedule',
  status: 'active',
  // A scheduled run has no trigger user, so data nodes execute unscoped
  // regardless; declaring `system` makes that RLS bypass explicit and intended
  // (ADR-0049, #1888).
  runAs: 'system',

  variables: [],

  nodes: [
    { id: 'start', type: 'start', label: 'Start (hourly)', config: { schedule: '0 * * * *' } },
    {
      id: 'query_breached', type: 'get_record', label: 'Find Unanswered Work Orders',
      config: {
        objectName: 'crm_work_order',
        filter: {
          status: { $nin: ['completed', 'closed', 'cancelled'] },
          is_sla_violated: false,
          responded_date: null,
          response_due_date: { $lt: '{NOW()}' },
        },
        limit: 500,
        outputVariable: 'workOrderList',
      },
    },
    {
      id: 'loop_work_orders', type: 'loop', label: 'For Each Breached Work Order',
      config: {
        collection: '{workOrderList}',
        iteratorVariable: 'currentWorkOrder',
        body: {
          nodes: [
            {
              id: 'flag_breach', type: 'update_record', label: 'Flag Response Breach',
              config: {
                objectName: 'crm_work_order',
                filter: { id: '{currentWorkOrder.id}' },
                // Only the breach flag is written. Unlike a case, a work order
                // is NOT force-escalated to another status: the job still has
                // to be scheduled and dispatched, and rewriting its status here
                // would fight the dispatcher and trip the state machine.
                fields: { is_sla_violated: true },
              },
            },
            {
              id: 'notify_supervisor', type: 'notify', label: 'Alert Service Supervisor',
              config: {
                to: ['{currentWorkOrder.owner}'],
                channels: ['inbox', 'email'],
                severity: 'critical',
                topic: 'work_order_sla_breach',
                title: 'Response overdue: work order {currentWorkOrder.work_order_number}',
                body: 'Work order {currentWorkOrder.work_order_number} ({currentWorkOrder.priority}) passed its response deadline with nobody assigned to respond.',
                actionUrl: '/crm_work_order/{currentWorkOrder.id}',
              },
            },
          ],
          edges: [
            { id: 'b1', source: 'flag_breach', target: 'notify_supervisor', type: 'default' },
          ],
        },
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],

  edges: [
    { id: 'e1', source: 'start', target: 'query_breached', type: 'default' },
    { id: 'e2', source: 'query_breached', target: 'loop_work_orders', type: 'default' },
    { id: 'e3', source: 'loop_work_orders', target: 'end', type: 'default' },
  ],
};
