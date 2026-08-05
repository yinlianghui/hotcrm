// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Field service seeds — assets (the installed base) and work orders (the
 * on-site visits against it). REQ-0002.
 *
 * Authored as its own family module per the split of the former monolithic
 * `src/data/index.ts` (#635). Seed doctrine lives in `./_shared.ts`; the
 * ownership rule ("a seed cannot name a user") lives in `./index.ts`.
 */
import { cel } from '@objectstack/spec';
import { defineSeed } from '@objectstack/spec/data';
import { Asset } from '../objects/asset.object';
import { WorkOrder } from '../objects/work_order.object';

// ─── Assets (installed base) ──────────────────────────────────────────
// REQ-0002. Per the doctrine in `./_shared.ts`, every hook-derived value below
// is written to match what `asset_warranty_defaults` would compute:
// `is_under_warranty` is exactly `warranty_end_date >= today`. Get that wrong
// and the hook rewrites the record at seed time.
//
// Coverage is deliberately mixed — some units in warranty, some out, one
// decommissioned — because the whole point of the billing rule is that it
// answers DIFFERENTLY per machine. A demo where everything is under warranty
// proves nothing.
export const assets = defineSeed(Asset, {
  mode: 'upsert',
  externalId: 'name',
  records: [
    {
      name: 'Acme Shanghai Line 2 — Edge Appliance',
      crm_account: 'Acme Corporation',
      crm_contact: 'john.smith@acme.example.com',
      crm_product: 'ObjectStack Platform',
      serial_number: 'ACM-EA-4471',
      status: 'installed',
      install_date: cel`daysAgo(400)`,
      warranty_start_date: cel`daysAgo(400)`,
      // Two-year coverage — still live.
      warranty_end_date: cel`daysFromNow(330)`,
      is_under_warranty: true,
      last_service_date: cel`daysAgo(45)`,
      description: 'On-site edge node driving the Line 2 press cell. Primary production dependency.',
    },
    {
      name: 'Acme Suzhou Line 1 — Edge Appliance',
      crm_account: 'Acme Corporation',
      crm_contact: 'john.smith@acme.example.com',
      crm_product: 'ObjectStack Platform',
      serial_number: 'ACM-EA-4472',
      status: 'installed',
      install_date: cel`daysAgo(900)`,
      warranty_start_date: cel`daysAgo(900)`,
      warranty_end_date: cel`daysAgo(170)`,
      // Out of coverage — every visit to this unit is chargeable.
      is_under_warranty: false,
      last_service_date: cel`daysAgo(210)`,
    },
    {
      name: 'Globex Plant A — Controller Rack',
      crm_account: 'Globex Industries',
      crm_contact: 'sarah.j@globex.example.com',
      crm_product: 'ObjectStack Platform',
      serial_number: 'GLX-CT-2210',
      // Currently down — there is an open work order against it below.
      status: 'in_repair',
      install_date: cel`daysAgo(250)`,
      warranty_start_date: cel`daysAgo(250)`,
      warranty_end_date: cel`daysFromNow(115)`,
      is_under_warranty: true,
      last_service_date: cel`daysAgo(12)`,
      description: 'Controller rack for the Plant A packaging line.',
    },
    {
      name: 'Initech HQ — Rack Unit 3',
      crm_account: 'Initech Solutions',
      crm_contact: 'mchen@initech.example.com',
      crm_product: 'ObjectStack Platform',
      serial_number: 'INI-RK-0087',
      status: 'installed',
      install_date: cel`daysAgo(120)`,
      warranty_start_date: cel`daysAgo(120)`,
      warranty_end_date: cel`daysFromNow(245)`,
      is_under_warranty: true,
    },
    {
      name: 'Stark Medical — Imaging Suite Gateway',
      crm_account: 'Stark Medical',
      crm_contact: 'emily.d@starkmed.example.com',
      crm_product: 'ObjectStack Platform',
      serial_number: 'STK-GW-5501',
      status: 'installed',
      install_date: cel`daysAgo(700)`,
      warranty_start_date: cel`daysAgo(700)`,
      warranty_end_date: cel`daysAgo(335)`,
      is_under_warranty: false,
      last_service_date: cel`daysAgo(90)`,
      description: 'Out of factory warranty. Renewal conversation open with the account team.',
    },
    {
      name: 'Wayne Tower — Data Hall Node',
      crm_account: 'Wayne Enterprises',
      crm_contact: 'rwilson@wayne.example.com',
      crm_product: 'ObjectStack Platform',
      serial_number: 'WYN-ND-3300',
      status: 'installed',
      install_date: cel`daysAgo(60)`,
      warranty_start_date: cel`daysAgo(60)`,
      warranty_end_date: cel`daysFromNow(305)`,
      is_under_warranty: true,
    },
    {
      name: 'Globex Plant B — Controller Rack (retired)',
      crm_account: 'Globex Industries',
      crm_product: 'ObjectStack Platform',
      serial_number: 'GLX-CT-1180',
      status: 'decommissioned',
      install_date: cel`daysAgo(1500)`,
      warranty_start_date: cel`daysAgo(1500)`,
      warranty_end_date: cel`daysAgo(770)`,
      is_under_warranty: false,
      description: 'Replaced by the Plant A rack. Kept for service history.',
    },
  ]
});

// ─── Work orders (on-site visits) ─────────────────────────────────────
// REQ-0002. Every hook-derived value matches what `work_order_defaults` would
// compute for the same row:
//   • `priority_rank` ⇔ priority (low 1 / medium 2 / high 3 / critical 4)
//   • `is_closed`     ⇔ status ∈ {closed, cancelled}
//   • `warranty_status` / `is_billable` ⇔ the linked asset's coverage
//   • `responded_date` present ⇔ status ≠ new
//
// `assigned_engineer` is NOT seeded — a seed cannot name a user (see the note
// in `./index.ts`). `demo_bootstrap` stamps it on first boot, and
// because that write goes through ObjectQL the hook runs and recomputes
// `has_schedule_conflict` for real.
//
// Schedule windows are day-granular: the seed vocabulary is `daysAgo` /
// `daysFromNow`, with no hour-level helper, so a visit is seeded as a
// start-day → next-day block. That satisfies `scheduled_end_after_start` and
// renders correctly on the day-scale dispatch calendar and engineer timeline.
export const workOrders = defineSeed(WorkOrder, {
  mode: 'upsert',
  externalId: 'subject',
  records: [
    {
      subject: 'Plant A controller rack rebooting under load',
      description: `Controller rack drops out under peak line load and reboots, halting the packaging line for 5-10 minutes each time. Started after Tuesday's throughput increase.

**Site impact:** roughly 40 minutes of lost line time per shift.`,
      crm_account: 'Globex Industries',
      crm_contact: 'sarah.j@globex.example.com',
      crm_asset: 'Globex Plant A — Controller Rack',
      type: 'repair',
      origin: 'phone',
      // `scheduled`, not `in_progress`: `engineer_required_for_dispatch` is an
      // ERROR-severity rule, and a seed cannot name a user (see the note in
      // `./index.ts`), so a seeded row can never legally reach a dispatched
      // state. `demo_bootstrap` assigns the engineer on first boot; moving the
      // job forward from there is a click.
      status: 'scheduled',
      priority: 'critical',
      priority_rank: 4,
      // Critical → 4-hour response promise, answered inside it.
      response_due_date: cel`daysAgo(1)`,
      responded_date: cel`daysAgo(1)`,
      is_sla_violated: false,
      scheduled_start: cel`daysAgo(1)`,
      scheduled_end: cel`daysFromNow(0)`,
      // Supplied, not derived: at hook time `scheduled_start` is still an
      // unresolved expression, so the hook cannot compute the day from it.
      scheduled_date: cel`daysAgo(1)`,
      has_schedule_conflict: false,
      // Asset is in warranty → the visit is free.
      warranty_status: 'under_warranty',
      is_billable: false,
      is_closed: false,
    },
    {
      subject: 'Suzhou edge appliance fan failure',
      description: 'Chassis fan alarm on the Suzhou Line 1 appliance. Unit still running but thermally throttled.',
      crm_account: 'Acme Corporation',
      crm_contact: 'john.smith@acme.example.com',
      crm_asset: 'Acme Suzhou Line 1 — Edge Appliance',
      type: 'repair',
      origin: 'chat',
      status: 'scheduled',
      priority: 'high',
      priority_rank: 3,
      response_due_date: cel`daysFromNow(0)`,
      responded_date: cel`daysAgo(0)`,
      is_sla_violated: false,
      scheduled_start: cel`daysFromNow(2)`,
      scheduled_end: cel`daysFromNow(3)`,
      scheduled_date: cel`daysFromNow(2)`,
      has_schedule_conflict: false,
      // Asset is OUT of warranty → chargeable, and flagged before dispatch.
      warranty_status: 'out_of_warranty',
      is_billable: true,
      service_charge: 2400,
      is_closed: false,
    },
    {
      subject: 'Imaging suite gateway quarterly inspection',
      description: 'Scheduled quarterly inspection of the imaging suite gateway per the service agreement.',
      crm_account: 'Stark Medical',
      crm_contact: 'emily.d@starkmed.example.com',
      crm_asset: 'Stark Medical — Imaging Suite Gateway',
      type: 'inspection',
      origin: 'proactive',
      // Same reason as above: a seeded row cannot carry an engineer, and
      // `dispatched` requires one.
      status: 'scheduled',
      priority: 'medium',
      priority_rank: 2,
      response_due_date: cel`daysFromNow(1)`,
      responded_date: cel`daysAgo(0)`,
      is_sla_violated: false,
      // Same window as the Suzhou visit above: one engineer, two sites, two
      // days. This is the pair the double-booking flag exists to surface once
      // `demo_bootstrap` assigns both to the same person.
      scheduled_start: cel`daysFromNow(2)`,
      scheduled_end: cel`daysFromNow(3)`,
      scheduled_date: cel`daysFromNow(2)`,
      has_schedule_conflict: false,
      warranty_status: 'out_of_warranty',
      is_billable: true,
      service_charge: 1800,
      is_closed: false,
    },
    {
      subject: 'Wayne data hall node commissioning',
      description: 'Commission the newly delivered data hall node: rack, cable, image and hand over to the site team.',
      crm_account: 'Wayne Enterprises',
      crm_contact: 'rwilson@wayne.example.com',
      crm_asset: 'Wayne Tower — Data Hall Node',
      type: 'installation',
      origin: 'case',
      status: 'new',
      priority: 'medium',
      priority_rank: 2,
      // Nobody has picked this up yet — it is the demo's "awaiting dispatch" row.
      response_due_date: cel`daysFromNow(1)`,
      is_sla_violated: false,
      has_schedule_conflict: false,
      warranty_status: 'under_warranty',
      is_billable: false,
      is_closed: false,
    },
    {
      subject: 'Initech rack unit firmware update',
      description: 'Apply the 4.2.1 firmware update to rack unit 3 during the agreed maintenance window.',
      crm_account: 'Initech Solutions',
      crm_contact: 'mchen@initech.example.com',
      crm_asset: 'Initech HQ — Rack Unit 3',
      type: 'maintenance',
      origin: 'email',
      status: 'new',
      priority: 'low',
      priority_rank: 1,
      // Deadline already passed with nobody assigned: this is the row
      // `work_order_sla_monitor` picks up on its next hourly pass.
      response_due_date: cel`daysAgo(1)`,
      is_sla_violated: false,
      has_schedule_conflict: false,
      warranty_status: 'under_warranty',
      is_billable: false,
      is_closed: false,
    },
    {
      subject: 'Shanghai Line 2 press cell calibration',
      description: 'Recalibrate the press cell after the Line 2 tooling change.',
      crm_account: 'Acme Corporation',
      crm_contact: 'john.smith@acme.example.com',
      crm_asset: 'Acme Shanghai Line 2 — Edge Appliance',
      type: 'maintenance',
      origin: 'phone',
      status: 'completed',
      priority: 'medium',
      priority_rank: 2,
      response_due_date: cel`daysAgo(46)`,
      responded_date: cel`daysAgo(46)`,
      is_sla_violated: false,
      scheduled_start: cel`daysAgo(46)`,
      scheduled_end: cel`daysAgo(45)`,
      scheduled_date: cel`daysAgo(46)`,
      has_schedule_conflict: false,
      warranty_status: 'under_warranty',
      is_billable: false,
      work_performed: 'Recalibrated the press cell against the new tooling profile and re-ran the acceptance cycle. All axes within tolerance.',
      parts_used: 'None',
      labor_hours: 3.5,
      completed_date: cel`daysAgo(45)`,
      signed_by: 'John Smith',
      signed_date: cel`daysAgo(45)`,
      customer_rating: 5,
      customer_feedback: 'Engineer arrived on time and finished inside the maintenance window.',
      is_closed: false,
    },
    {
      subject: 'Plant B controller decommissioning',
      description: 'Remove and dispose of the retired Plant B controller rack; return the licence dongle.',
      crm_account: 'Globex Industries',
      crm_asset: 'Globex Plant B — Controller Rack (retired)',
      type: 'repair',
      origin: 'proactive',
      status: 'closed',
      priority: 'low',
      priority_rank: 1,
      response_due_date: cel`daysAgo(120)`,
      responded_date: cel`daysAgo(120)`,
      is_sla_violated: false,
      scheduled_start: cel`daysAgo(119)`,
      scheduled_end: cel`daysAgo(118)`,
      scheduled_date: cel`daysAgo(119)`,
      has_schedule_conflict: false,
      // Chargeable and charged — this is the row that gives the billing table
      // on the Field Service dashboard a non-zero revenue number.
      warranty_status: 'out_of_warranty',
      is_billable: true,
      service_charge: 3600,
      work_performed: 'Decommissioned and removed the Plant B rack. Licence dongle returned to inventory.',
      parts_used: 'None',
      labor_hours: 5,
      completed_date: cel`daysAgo(118)`,
      signed_by: 'Sarah Johnson',
      signed_date: cel`daysAgo(118)`,
      customer_rating: 4,
      // Terminal status → is_closed is true, matching what the hook computes.
      is_closed: true,
    },
  ]
});

