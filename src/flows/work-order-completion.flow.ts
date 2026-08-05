// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type * as Automation from '@objectstack/spec/automation';
type Flow = Automation.Flow;

/**
 * Complete Visit — REQ-0002 ask #4.
 *
 * "工程师上门干完活要登记做了什么，客户签字确认." The object already carries
 * every field this writes, and two of them are hard validations
 * (`work_performed_required_for_completion`, `signature_name_required_for_completion`).
 * This screen exists so the engineer meets those rules by filling one form,
 * instead of discovering them as save errors after flipping the status.
 *
 * The drawn signature is NOT collected here: a screen flow renders form
 * primitives, and the signature pad is a record-form control. The flow captures
 * the accountable NAME (which is the hard rule) and the engineer draws the
 * signature on the record's Completion tab — which is also why the schema keeps
 * the missing-signature rule at `warning` severity rather than `error`.
 *
 * Screen flow rather than a `body`-typed action, for the reason documented at
 * `src/actions/case.actions.ts`: a script body cannot UPDATE a record on a
 * sharing-ruled object.
 */
export const CompleteWorkOrderFlow: Flow = {
  name: 'complete_work_order',
  label: 'Complete Visit',
  description: 'Record the on-site work, parts, hours and customer acceptance, then complete the work order.',
  type: 'screen',
  status: 'active',

  variables: [
    // MUST be `recordId` — the console's flow-action contract seeds only that
    // name (and its camelCase object alias); a custom name arrives undefined.
    { name: 'recordId', type: 'text', isInput: true, isOutput: false },
    { name: 'workPerformed', type: 'text', isInput: true, isOutput: false },
    { name: 'partsUsed', type: 'text', isInput: true, isOutput: false },
    { name: 'laborHours', type: 'number', isInput: true, isOutput: false },
    { name: 'signedBy', type: 'text', isInput: true, isOutput: false },
    { name: 'serviceCharge', type: 'number', isInput: true, isOutput: false },
  ],

  nodes: [
    { id: 'start', type: 'start', label: 'Start', config: { objectName: 'crm_work_order' } },
    {
      id: 'screen_1', type: 'screen', label: 'On-Site Completion',
      config: {
        fields: [
          {
            name: 'workPerformed', label: 'Work Performed', type: 'textarea', required: true,
            // Required here because the object rejects a completion without it;
            // asking on the screen turns a save error into a form field.
          },
          { name: 'partsUsed', label: 'Parts Used', type: 'textarea' },
          { name: 'laborHours', label: 'Labor Hours', type: 'number' },
          {
            name: 'signedBy', label: 'Accepted By (customer name)', type: 'text', required: true,
          },
          {
            name: 'serviceCharge', label: 'Service Charge', type: 'currency',
            // Left optional on the screen: whether this visit is chargeable is
            // already decided on the record (`is_billable`, resolved from the
            // asset's warranty), and the object raises its own warning if a
            // billable visit completes without a charge.
          },
        ],
      },
    },
    {
      id: 'complete', type: 'update_record', label: 'Complete Work Order',
      config: {
        objectName: 'crm_work_order',
        filter: { id: '{recordId}' },
        fields: {
          status: 'completed',
          work_performed: '{workPerformed}',
          parts_used: '{partsUsed}',
          labor_hours: '{laborHours}',
          signed_by: '{signedBy}',
          service_charge: '{serviceCharge}',
          // `completed_date` and `signed_date` are stamped by
          // `work_order_defaults` on this same write — not repeated here, so
          // there is exactly one place that decides when "now" is.
        },
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],

  edges: [
    { id: 'e1', source: 'start', target: 'screen_1', type: 'default' },
    { id: 'e2', source: 'screen_1', target: 'complete', type: 'default' },
    { id: 'e3', source: 'complete', target: 'end', type: 'default' },
  ],
};
