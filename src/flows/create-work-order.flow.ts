// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type * as Automation from '@objectstack/spec/automation';
type Flow = Automation.Flow;

/**
 * Create Work Order from a Case — REQ-0002's hand-off.
 *
 * "我们客服部现在用系统里的客服工单（Case）接报修电话，希望这套东西能接得上，
 * 别让客服再录一遍." The agent who took the call already typed the account, the
 * contact and what is broken. This action carries all of it onto the work order
 * and links the two records, so the desk hands off instead of re-keying.
 *
 * A SCREEN FLOW rather than a `body`-typed action, for the reasons written up
 * in `src/flows/case-actions.flow.ts`: `type: 'modal'` actions never execute
 * their body in 16.1.0, and while a `script` body CAN insert, the screen is
 * what lets the agent set the two things the case does not already know — what
 * kind of visit this is, and how urgent it is on the FIELD scale.
 *
 * The asset is deliberately NOT asked for here. Identifying the exact machine is
 * dispatch's job (they have the installed base in front of them), and the
 * moment they set it, `work_order.hook.ts` resolves warranty → billable, which
 * is what puts the charge on the record before anyone drives out.
 */
export const CreateWorkOrderFlow: Flow = {
  name: 'create_work_order',
  label: 'Create Work Order',
  description: 'Raise a field-service work order from a support case, carrying over the customer and the reported problem.',
  type: 'screen',
  status: 'active',

  variables: [
    // MUST be `recordId` — the console's flow-action contract seeds only that
    // name (and its camelCase object alias); a custom name arrives undefined.
    { name: 'recordId', type: 'text', isInput: true, isOutput: false },
    { name: 'workType', type: 'text', isInput: true, isOutput: false },
    { name: 'priority', type: 'text', isInput: true, isOutput: false },
    { name: 'dispatchNotes', type: 'text', isInput: true, isOutput: false },
  ],

  nodes: [
    { id: 'start', type: 'start', label: 'Start', config: { objectName: 'crm_case' } },
    {
      id: 'screen_1', type: 'screen', label: 'Raise Work Order',
      config: {
        fields: [
          {
            name: 'workType', label: 'Work Type', type: 'select', required: true,
            // Mirrors `crm_work_order.type` exactly — a hand-copied subset here
            // would silently drop options from the picker (#490).
            options: [
              { label: 'Repair', value: 'repair' },
              { label: 'Preventive Maintenance', value: 'maintenance' },
              { label: 'Installation', value: 'installation' },
              { label: 'Inspection', value: 'inspection' },
            ],
          },
          {
            name: 'priority', label: 'Priority', type: 'select', required: true,
            // Mirrors `crm_work_order.priority`. Critical = the customer's
            // "紧急" tier (4-hour response); Medium = "普通" (same day).
            options: [
              { label: 'Low', value: 'low' },
              { label: 'Medium (same-day response)', value: 'medium' },
              { label: 'High', value: 'high' },
              { label: 'Critical (4-hour response)', value: 'critical' },
            ],
          },
          { name: 'dispatchNotes', label: 'Dispatch Notes', type: 'textarea' },
        ],
      },
    },
    {
      id: 'get_case', type: 'get_record', label: 'Get Case Record',
      config: { objectName: 'crm_case', filter: { id: '{recordId}' }, outputVariable: 'caseRecord' },
    },
    {
      id: 'create_work_order', type: 'create_record', label: 'Create Work Order',
      config: {
        objectName: 'crm_work_order',
        fields: {
          // Everything below already exists on the case — this is the whole
          // point of the action.
          subject: '{caseRecord.subject}',
          description: '{caseRecord.description}',
          crm_account: '{caseRecord.crm_account}',
          crm_contact: '{caseRecord.crm_contact}',
          crm_case: '{recordId}',
          type: '{workType}',
          priority: '{priority}',
          origin: 'case',
          status: 'new',
          internal_notes: '{dispatchNotes}',
          // The agent raising it owns the SLA until dispatch reassigns it.
          owner: '{$User.Id}',
        },
        outputVariable: 'createdWorkOrder',
      },
    },
    {
      // Park the case rather than close it: the repair is now tracked on the
      // work order, but the customer conversation stays open until the visit
      // lands. Closing here would strand the caller.
      id: 'park_case', type: 'update_record', label: 'Mark Case Awaiting Field Service',
      config: {
        objectName: 'crm_case',
        filter: { id: '{recordId}' },
        fields: { status: 'waiting_support' },
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],

  edges: [
    { id: 'e1', source: 'start', target: 'screen_1', type: 'default' },
    { id: 'e2', source: 'screen_1', target: 'get_case', type: 'default' },
    { id: 'e3', source: 'get_case', target: 'create_work_order', type: 'default' },
    { id: 'e4', source: 'create_work_order', target: 'park_case', type: 'default' },
    { id: 'e5', source: 'park_case', target: 'end', type: 'default' },
  ],
};
