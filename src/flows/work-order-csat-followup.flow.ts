// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { P } from '@objectstack/spec';
import type * as Automation from '@objectstack/spec/automation';
type Flow = Automation.Flow;

/**
 * Work Order CSAT Follow-up — REQ-0002 ask #6.
 *
 * "修完了要像现在客服工单一样回访，让客户打个分." Taken literally: this is
 * `case_csat_followup`, re-bound to the visit. Same trigger shape, same 24h
 * `wait` node (BPMN intermediate timer — the flow itself spans the delay, so no
 * second scheduled job is needed), same "prompt the owner to collect it".
 *
 * Fires on `completed` rather than `closed`: the visit is what the customer is
 * being asked about, and a work order can sit in `completed` for days while
 * billing catches up. Waiting for `closed` would ask about a repair the
 * customer has stopped thinking about.
 */
export const WorkOrderCsatFollowupFlow: Flow = {
  name: 'work_order_csat_followup',
  label: 'Work Order CSAT Follow-up',
  description: 'A day after the visit is completed, prompt the supervisor to collect a satisfaction rating.',
  type: 'record_change',
  status: 'active',

  variables: [],

  nodes: [
    {
      // Bound to the ObjectQL afterUpdate hook and gated on the transition
      // itself (record vs previous), so it fires once — when the visit actually
      // completes, not on every subsequent save of a completed work order.
      //
      // TOTALITY (#633): every `record.x` / `previous.x` read carries a
      // `has(…)` guard — driver-memory / driver-mongodb return rows without
      // the columns they were never written with, and strict CEL aborts on a
      // missing key, recording the run as FAILED instead of "did not fire".
      id: 'start', type: 'start', label: 'Start (visit completed)',
      config: {
        objectName: 'crm_work_order',
        triggerType: 'record-after-update',
        condition: P`has(record.status) && record.status == "completed"
          && (previous == null || !has(previous.status) || previous.status != "completed")`,
      },
    },
    {
      id: 'wait_1d', type: 'wait', label: 'Wait 1 Day',
      waitEventConfig: { eventType: 'timer', timerDuration: 'P1D' },
    },
    {
      id: 'notify_csat', type: 'notify', label: 'Request Satisfaction Rating',
      config: {
        to: ['{record.owner}'],
        channels: ['inbox', 'email'],
        topic: 'work_order_csat',
        title: 'Collect CSAT: work order {record.work_order_number}',
        body: 'The visit for work order {record.work_order_number} was completed yesterday. Call the site contact and log their satisfaction rating.',
        actionUrl: '/crm_work_order/{record.id}',
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],

  edges: [
    { id: 'e1', source: 'start', target: 'wait_1d', type: 'default' },
    { id: 'e2', source: 'wait_1d', target: 'notify_csat', type: 'default' },
    { id: 'e3', source: 'notify_csat', target: 'end', type: 'default' },
  ],
};
