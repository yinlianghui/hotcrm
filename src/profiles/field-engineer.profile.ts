// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Field Engineer Profile — REQ-0002.
 *
 * The person who drives to the site. Distinct from `service_agent` (who works
 * the phone queue and dispatches) in exactly one way that matters: an engineer
 * WRITES the completion record on jobs they were assigned, and reads — but does
 * not rewrite — everything else.
 *
 * The shape below is broad-grant + row-level narrowing, the same pattern
 * `marketing_user` uses for campaigns, and it is deliberate:
 *
 *   • `crm_work_order` is `private` OWD, so without `viewAllRecords` an engineer
 *     sees only work orders they OWN — and they own none of them (`owner` is the
 *     supervisor accountable for the SLA). The board would be empty.
 *   • Without `modifyAllRecords` the same is true of writes: the engineer could
 *     not complete the job they were sent on.
 *   • So both are granted at the object level and the `rowLevelSecurity` policy
 *     below is what actually scopes writes to "jobs assigned to me". Reads stay
 *     team-wide on purpose: an engineer needs to see who is covering what before
 *     agreeing to a swap.
 */
export const FieldEngineerProfile = {
  name: 'field_engineer',
  label: 'Field Engineer',
  objects: {
    // Context for the visit. Org-wide reads, no writes: an engineer must be
    // able to look up any customer whose site they are sent to, which is not
    // the same as being allowed to edit that customer.
    crm_account: { allowCreate: false, allowRead: true, allowEdit: false, allowDelete: false, viewAllRecords: true, modifyAllRecords: false },
    crm_contact: { allowCreate: false, allowRead: true, allowEdit: false, allowDelete: false, viewAllRecords: true, modifyAllRecords: false },
    crm_product: { allowCreate: false, allowRead: true, allowEdit: false, allowDelete: false, viewAllRecords: true, modifyAllRecords: false },
    // The originating ticket, for the customer's own words. Read-only —
    // the case belongs to the desk.
    crm_case:    { allowCreate: false, allowRead: true, allowEdit: false, allowDelete: false, viewAllRecords: true, modifyAllRecords: false },
    // The installed base. `crm_asset` is `public_read` OWD, so reads are open
    // anyway; the edit grant is what lets an engineer correct a serial number
    // or a site address they find wrong on arrival — the single most common
    // source of bad installed-base data.
    crm_asset:   { allowCreate: false, allowRead: true, allowEdit: true, allowDelete: false, viewAllRecords: true, modifyAllRecords: false },
    // The job itself — see the class comment for why both org-wide flags are on
    // and what narrows them back.
    crm_work_order: { allowCreate: false, allowRead: true, allowEdit: true, allowDelete: false, viewAllRecords: true, modifyAllRecords: true },
    // An engineer's own follow-ups ("order the part, go back Thursday").
    crm_task:    { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: false, viewAllRecords: false, modifyAllRecords: false, readScope: 'own' as const },
    // Repair procedures. Read-only: authoring belongs to service.
    crm_knowledge_article: { allowCreate: false, allowRead: true, allowEdit: false, allowDelete: false, viewAllRecords: true, modifyAllRecords: false },
  },
  fields: {
    // Billing is a commercial decision made before dispatch, not something the
    // engineer renegotiates on the customer's doorstep. Visible — they must be
    // able to tell the customer this visit is chargeable — but not editable.
    'crm_work_order.is_billable':     { readable: true, editable: false },
    'crm_work_order.warranty_status': { readable: true, editable: false },
    // The SLA belongs to the supervisor who is measured on it.
    'crm_work_order.is_sla_violated': { readable: true, editable: false },
    'crm_work_order.response_due_date': { readable: true, editable: false },
    // Dispatch notes are the desk's working memory about the customer.
    'crm_work_order.internal_notes':  { readable: false, editable: false },
  },
  rowLevelSecurity: [
    {
      name: 'work_order_engineer_writes_own_jobs',
      label: 'Engineers only update the jobs assigned to them',
      description:
        'Object-level modify is org-wide so an assigned engineer can complete a work order they do not own; this policy is what keeps them out of everyone else\'s.',
      object: 'crm_work_order',
      operation: 'update' as const,
      using: 'assigned_engineer == current_user.id',
    },
  ],
};
