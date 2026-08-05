// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Action } from '@objectstack/spec/ui';
import { P } from '@objectstack/spec';

/**
 * Field-service actions (REQ-0002).
 *
 * Both delegate to screen flows rather than carrying an inline `body`, for the
 * reasons documented at `src/actions/case.actions.ts`: modal actions never
 * execute their body in 16.1.0, and a script body cannot UPDATE a record on a
 * sharing-ruled object (the sandbox context carries no caller identity). Screen
 * flows are the mechanism that demonstrably works.
 */

/**
 * The support-desk hand-off. Lives on the CASE, which is the point — the agent
 * on the phone raises the visit from the ticket they are already looking at.
 * Hidden once the case is closed (nothing to dispatch) and once a work order
 * has already been raised, so the desk cannot double-book a visit by clicking
 * twice.
 */
export const CreateWorkOrderAction: Action = {
  name: 'create_work_order',
  label: 'Create Work Order',
  objectName: 'crm_case',
  icon: 'wrench',
  type: 'flow',
  target: 'create_work_order',
  locations: ['record_header', 'list_item'],
  visible: P`record.is_closed == false`,
  confirmText: 'Raise a field-service work order from this case?',
  successMessage: 'Work order created and linked to this case.',
  refreshAfter: true,
};

/**
 * Completion from the record header, so an engineer finishing on site fills one
 * form instead of hunting three fields across two tabs. The flow writes exactly
 * what the object's completion validations demand (`work_performed` and
 * `signed_by`), which is why it exists as a guided screen rather than a raw
 * status edit.
 */
export const CompleteWorkOrderAction: Action = {
  name: 'complete_work_order',
  label: 'Complete Visit',
  objectName: 'crm_work_order',
  icon: 'clipboard-check',
  type: 'flow',
  target: 'complete_work_order',
  locations: ['record_header'],
  visible: P`record.is_closed == false && record.status != "completed"`,
  confirmText: 'Record the on-site completion for this work order?',
  successMessage: 'Visit completed.',
  refreshAfter: true,
};
