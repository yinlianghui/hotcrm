// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

export const ServiceAgentProfile = {
  name: 'service_agent',
  label: 'Service Agent',
  objects: {
    // Reference context an agent needs to work ANY ticket — a customer's cases
    // are meaningless without seeing the account/contact behind them, so these
    // are org-visible reads (viewAllRecords: true), NOT own-only. This was the
    // security-private-no-readscope warning's real signal: allowRead on a
    // private object with no scope had silently locked agents out of every
    // account they didn't personally own.
    // `allowExport` where an export surface exists — canonical note in
    // `src/profiles/index.ts`. `crm_opportunity` carries no export bit: this
    // set has no read on it at all, and the axis never widens read.
    crm_lead:        { allowCreate: false, allowRead: true,  allowEdit: false, allowDelete: false, viewAllRecords: true,  modifyAllRecords: false, allowExport: true },
    crm_account:     { allowCreate: false, allowRead: true,  allowEdit: false, allowDelete: false, viewAllRecords: true,  modifyAllRecords: false, allowExport: true },
    crm_contact:     { allowCreate: false, allowRead: true,  allowEdit: true,  allowDelete: false, viewAllRecords: true,  modifyAllRecords: false, allowExport: true },
    crm_opportunity: { allowCreate: false, allowRead: false, allowEdit: false, allowDelete: false, viewAllRecords: false, modifyAllRecords: false },
    // Cases + tasks: an agent's own queue by default (readScope: 'own').
    // Cross-agent visibility exists for CASES only — the escalation rules widen
    // open critical cases to service_manager / service_director. `crm_task` has
    // no sharing rule at all, so an agent reading an account org-wide still
    // sees only their own tasks on it (#549).
    crm_case:        { allowCreate: true,  allowRead: true,  allowEdit: true,  allowDelete: false, viewAllRecords: false, modifyAllRecords: false, readScope: 'own' as const, allowExport: true },
    crm_task:        { allowCreate: true,  allowRead: true,  allowEdit: true,  allowDelete: true,  viewAllRecords: false, modifyAllRecords: false, readScope: 'own' as const },
    crm_product:     { allowCreate: false, allowRead: true,  allowEdit: false, allowDelete: false, viewAllRecords: true,  modifyAllRecords: false },
    // The knowledge base is this team's own surface: agents draft and revise
    // articles (draft → in_review → published is enforced by the KB flow, not by
    // CRUD), and read every published article regardless of author. Archiving
    // is destructive-by-policy, so deletion stays with admins. Before #488 the
    // object had no grant at all — the "Knowledge" nav item was denied for
    // everyone, including the agents it was built for.
    crm_knowledge_article: { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: false, viewAllRecords: true, modifyAllRecords: false },
    // Field service (REQ-0002). This profile covers the desk AND dispatch: the
    // agent who takes the repair call is the one who raises the work order and
    // sends an engineer. Dispatching means editing a job somebody else owns, so
    // `crm_work_order` carries org-wide view AND modify — unlike the agent's own
    // case queue above, which stays owner-scoped. Assets are the installed base
    // the agent looks up while the customer is still on the phone; they read it
    // and correct it, but the record's commercial owner is the account team.
    crm_asset:      { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: false, viewAllRecords: true, modifyAllRecords: false, allowExport: true },
    crm_work_order: { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: false, viewAllRecords: true, modifyAllRecords: true, allowExport: true },
  },
  fields: {
    'crm_case.is_sla_violated':        { readable: true, editable: false },
    'crm_case.resolution_time_hours':  { readable: true, editable: false },
    // Internal notes are the agent's working memory on a ticket — full access
    // here, read-only for sales_manager, masked for sales_rep (#488).
    'crm_case.internal_notes':         { readable: true, editable: true },
    // Account health is renewal-team data an agent reads for context only.
    'crm_account.health_score':        { readable: true, editable: false },
  },
};
