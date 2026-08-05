// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { AssetWarrantyExpiryFlow } from '../src/flows/asset-warranty-expiry.flow';
import { CreateWorkOrderFlow } from '../src/flows/create-work-order.flow';
import { CompleteWorkOrderFlow } from '../src/flows/work-order-completion.flow';
import { WorkOrderCsatFollowupFlow } from '../src/flows/work-order-csat-followup.flow';
import { WorkOrderSlaMonitorFlow } from '../src/flows/work-order-sla-monitor.flow';
import { makeFlowHarness, type Rec } from './helpers/flow-harness';

/**
 * Runtime tests for the FIELD-SERVICE flows (REQ-0002).
 *
 * The two sweeps here are the hardest kind of flow to keep honest, for the same
 * reason `flow-scheduled.test.ts` spells out: a sweep whose filter matches
 * nothing is indistinguishable from a sweep with nothing to do. Every case below
 * therefore seeds BOTH the rows that must be picked up and the rows that must be
 * left alone, so a filter that silently matches everything — or nothing — fails.
 */

const iso = (daysFromNow: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString();
};
const day = (daysFromNow: number): string => iso(daysFromNow).slice(0, 10);

// ───────────────────────────────────── work_order_sla_monitor (sweep) ──

describe('work_order_sla_monitor — hourly response-breach sweep', () => {
  const seedWorkOrders = (): Rec[] => [
    // Deadline passed, nobody responded — MUST be flagged.
    {
      id: 'w_breached', work_order_number: 'WO-1', status: 'new', priority: 'critical',
      is_sla_violated: false, response_due_date: iso(-1), responded_date: null, owner: 'sup1',
    },
    // Deadline is in the future — leave alone.
    {
      id: 'w_future', work_order_number: 'WO-2', status: 'new', priority: 'high',
      is_sla_violated: false, response_due_date: iso(+1), responded_date: null, owner: 'sup1',
    },
    // Deadline passed BUT somebody responded: the promise was "respond", and it
    // was kept. This is the row a naive status-based filter gets wrong.
    {
      id: 'w_answered', work_order_number: 'WO-3', status: 'scheduled', priority: 'critical',
      is_sla_violated: false, response_due_date: iso(-2), responded_date: iso(-2), owner: 'sup1',
    },
    // Finished work — excluded even though its deadline is long past.
    {
      id: 'w_completed', work_order_number: 'WO-4', status: 'completed', priority: 'medium',
      is_sla_violated: false, response_due_date: iso(-9), responded_date: null, owner: 'sup1',
    },
    {
      id: 'w_cancelled', work_order_number: 'WO-5', status: 'cancelled', priority: 'low',
      is_sla_violated: false, response_due_date: iso(-9), responded_date: null, owner: 'sup1',
    },
    // Already flagged — must not be re-processed or re-notified.
    {
      id: 'w_already', work_order_number: 'WO-6', status: 'new', priority: 'critical',
      is_sla_violated: true, response_due_date: iso(-3), responded_date: null, owner: 'sup1',
    },
  ];

  const runSweep = async () => {
    const h = makeFlowHarness(
      { work_order_sla_monitor: WorkOrderSlaMonitorFlow },
      { crm_work_order: seedWorkOrders() },
    );
    await h.run('work_order_sla_monitor', {}, { event: 'schedule' });
    return h;
  };

  it('flags exactly the open, past-due, unanswered work orders', async () => {
    const h = await runSweep();
    const byId = Object.fromEntries(h.store.crm_work_order.map((w) => [w.id, w]));

    expect(byId.w_breached.is_sla_violated).toBe(true);
    expect(byId.w_future.is_sla_violated).toBe(false);
    expect(byId.w_answered.is_sla_violated, 'a job that was answered met its promise').toBe(false);
    expect(byId.w_completed.is_sla_violated).toBe(false);
    expect(byId.w_cancelled.is_sla_violated).toBe(false);
  });

  it('does not rewrite the dispatcher’s status', async () => {
    // Unlike a case, a breached work order still has to be scheduled and sent.
    // Forcing a status here would fight dispatch and trip the state machine.
    const h = await runSweep();
    const breached = h.store.crm_work_order.find((w) => w.id === 'w_breached')!;
    expect(breached.status).toBe('new');
  });

  it('alerts the service supervisor — the owner, not the engineer', async () => {
    const h = await runSweep();
    expect(h.notifications).toHaveLength(1);
    const [note] = h.notifications;
    expect(note.to).toEqual(['sup1']);
    expect(note.severity).toBe('critical');
    expect(note.topic).toBe('work_order_sla_breach');
    // A lookup dot-walk would interpolate to the literal "undefined".
    expect(JSON.stringify(note)).not.toContain('undefined');
  });

  it('notifies once per breach, not once per sweep over already-flagged rows', async () => {
    const h = await runSweep();
    const recipients = h.notifications.map((n) => n.title);
    expect(recipients).toHaveLength(1);
    expect(recipients[0]).toContain('WO-1');
  });
});

// ────────────────────────────────────── asset_warranty_expiry (sweep) ──

describe('asset_warranty_expiry — daily coverage sweep', () => {
  const seedAssets = (): Rec[] => [
    // Coverage ran out while nothing wrote to the record — MUST be cleared.
    {
      id: 'a_lapsed', asset_number: 'AST-1', name: 'Suzhou appliance', status: 'installed',
      is_under_warranty: true, warranty_end_date: day(-2), owner: 'acct1',
    },
    // Still covered — leave alone.
    {
      id: 'a_covered', asset_number: 'AST-2', name: 'Shanghai appliance', status: 'installed',
      is_under_warranty: true, warranty_end_date: day(+90), owner: 'acct1',
    },
    // Already cleared — must not be re-processed or re-notified.
    {
      id: 'a_already', asset_number: 'AST-3', name: 'Old gateway', status: 'installed',
      is_under_warranty: false, warranty_end_date: day(-400), owner: 'acct1',
    },
    // Retired equipment: nobody needs a warranty warning about a machine that
    // is gone.
    {
      id: 'a_retired', asset_number: 'AST-4', name: 'Retired rack', status: 'decommissioned',
      is_under_warranty: true, warranty_end_date: day(-30), owner: 'acct1',
    },
  ];

  const runSweep = async () => {
    const h = makeFlowHarness(
      { asset_warranty_expiry: AssetWarrantyExpiryFlow },
      { crm_asset: seedAssets() },
    );
    await h.run('asset_warranty_expiry', {}, { event: 'schedule' });
    return h;
  };

  it('clears coverage on exactly the lapsed, live assets', async () => {
    const h = await runSweep();
    const byId = Object.fromEntries(h.store.crm_asset.map((a) => [a.id, a]));

    expect(byId.a_lapsed.is_under_warranty).toBe(false);
    expect(byId.a_covered.is_under_warranty, 'still in coverage').toBe(true);
    expect(byId.a_retired.is_under_warranty, 'decommissioned units are skipped').toBe(true);
  });

  it('notifies the asset owner once, naming the machine', async () => {
    const h = await runSweep();
    expect(h.notifications).toHaveLength(1);
    const [note] = h.notifications;
    expect(note.to).toEqual(['acct1']);
    expect(note.topic).toBe('asset_warranty_expired');
    expect(note.title).toContain('AST-1');
    expect(JSON.stringify(note)).not.toContain('undefined');
  });

  it('is idempotent — a second pass finds nothing left to do', async () => {
    const h = makeFlowHarness(
      { asset_warranty_expiry: AssetWarrantyExpiryFlow },
      { crm_asset: seedAssets() },
    );
    await h.run('asset_warranty_expiry', {}, { event: 'schedule' });
    await h.run('asset_warranty_expiry', {}, { event: 'schedule' });
    expect(h.notifications, 'the second sweep must be a no-op').toHaveLength(1);
  });
});

// ──────────────────────────────────────────── create_work_order (screen) ──

describe('create_work_order — the support-desk hand-off', () => {
  const openCase = (over: Rec = {}): Rec => ({
    id: 'c1', case_number: 'CASE-1', subject: 'Controller rack rebooting',
    description: 'Rack reboots under peak load, halting the line.',
    crm_account: 'acc1', crm_contact: 'con1',
    status: 'in_progress', priority: 'high', is_closed: false, owner: 'agent1', ...over,
  });

  const run = async (screen: Rec, seed: Rec[] = [openCase()]) => {
    const h = makeFlowHarness({ create_work_order: CreateWorkOrderFlow }, { crm_case: seed });
    const runId = await h.run('create_work_order', { recordId: 'c1' });
    expect(runId, 'create_work_order did not start').toBeTruthy();
    await h.resume(runId!, screen);
    return h;
  };

  it('seeds its input from the console’s `recordId` contract', () => {
    // A custom name arrives undefined and the whole action silently no-ops.
    const names = (CreateWorkOrderFlow.variables ?? []).map((v) => v.name);
    expect(names).toContain('recordId');
  });

  it('carries the customer and the reported problem across without re-keying', async () => {
    // This IS the requirement: "别让客服再录一遍".
    const h = await run({ recordId: 'c1', workType: 'repair', priority: 'critical', dispatchNotes: 'Site open until 18:00' });

    const wo = h.store.crm_work_order[0];
    expect(wo).toBeTruthy();
    expect(wo.subject).toBe('Controller rack rebooting');
    expect(wo.description).toBe('Rack reboots under peak load, halting the line.');
    expect(wo.crm_account).toBe('acc1');
    expect(wo.crm_contact).toBe('con1');
    expect(wo.internal_notes).toBe('Site open until 18:00');
  });

  it('links both records so the desk can follow the visit', async () => {
    const h = await run({ recordId: 'c1', workType: 'repair', priority: 'medium' });
    expect(h.store.crm_work_order[0].crm_case).toBe('c1');
    expect(h.store.crm_work_order[0].origin).toBe('case');
  });

  it('takes the work type and field priority from the screen, not from the case', async () => {
    // The case's own `priority: 'high'` must not leak through — the field scale
    // is a separate judgement the agent makes.
    const h = await run({ recordId: 'c1', workType: 'inspection', priority: 'low' });
    expect(h.store.crm_work_order[0].type).toBe('inspection');
    expect(h.store.crm_work_order[0].priority).toBe('low');
  });

  it('parks the case instead of closing it', async () => {
    // The repair is tracked on the work order now, but the customer
    // conversation stays open until the visit lands.
    const h = await run({ recordId: 'c1', workType: 'repair', priority: 'medium' });
    const parked = h.store.crm_case.find((c) => c.id === 'c1')!;
    expect(parked.status).toBe('waiting_support');
    expect(parked.is_closed).toBe(false);
  });

  it('leaves other cases untouched', async () => {
    const h = await run(
      { recordId: 'c1', workType: 'repair', priority: 'medium' },
      [openCase(), openCase({ id: 'c2', case_number: 'CASE-2' })],
    );
    expect(h.store.crm_case.find((c) => c.id === 'c2')!.status).toBe('in_progress');
    expect(h.store.crm_work_order).toHaveLength(1);
  });
});

// ────────────────────────────────────────── complete_work_order (screen) ──

describe('complete_work_order — on-site completion', () => {
  const job = (over: Rec = {}): Rec => ({
    id: 'w1', work_order_number: 'WO-1', status: 'in_progress', priority: 'medium',
    is_closed: false, is_billable: true, owner: 'sup1', assigned_engineer: 'eng1', ...over,
  });

  const run = async (screen: Rec, seed: Rec[] = [job()]) => {
    const h = makeFlowHarness({ complete_work_order: CompleteWorkOrderFlow }, { crm_work_order: seed });
    const runId = await h.run('complete_work_order', { recordId: 'w1' });
    expect(runId, 'complete_work_order did not start').toBeTruthy();
    await h.resume(runId!, screen);
    return h;
  };

  it('seeds its input from the console’s `recordId` contract', () => {
    const names = (CompleteWorkOrderFlow.variables ?? []).map((v) => v.name);
    expect(names).toContain('recordId');
  });

  it('writes everything the object’s completion validations demand', async () => {
    // `work_performed_required_for_completion` and
    // `signature_name_required_for_completion` are severity: error — a
    // completion missing either is rejected outright, and the button would
    // appear to do nothing.
    const h = await run({
      recordId: 'w1',
      workPerformed: 'Replaced the fan tray and re-ran the acceptance cycle.',
      partsUsed: 'Fan tray FT-220',
      laborHours: 2.5,
      signedBy: 'Sarah Johnson',
      serviceCharge: 2400,
    });

    const done = h.store.crm_work_order[0];
    expect(done.status).toBe('completed');
    expect(done.work_performed).toContain('Replaced the fan tray');
    expect(done.signed_by).toBe('Sarah Johnson');
  });

  it('records parts, hours and the charge for the billing run', async () => {
    const h = await run({
      recordId: 'w1',
      workPerformed: 'Swapped the PSU.',
      partsUsed: 'PSU-750',
      laborHours: 1.5,
      signedBy: 'John Smith',
      serviceCharge: 1800,
    });
    const done = h.store.crm_work_order[0];
    expect(done.parts_used).toBe('PSU-750');
    expect(done.labor_hours).toBe(1.5);
    expect(done.service_charge).toBe(1800);
  });

  it('completes only the targeted job', async () => {
    const h = await run(
      { recordId: 'w1', workPerformed: 'Done', signedBy: 'John Smith' },
      [job(), job({ id: 'w2', work_order_number: 'WO-2' })],
    );
    expect(h.store.crm_work_order.find((w) => w.id === 'w2')!.status).toBe('in_progress');
  });
});

// ─────────────────────────────────── work_order_csat_followup (trigger) ──

describe('work_order_csat_followup — post-visit call-back', () => {
  /**
   * This flow spans a 24h `wait` node, and the harness has no timer-resume, so
   * what is provable here is the half that actually breaks in practice: WHETHER
   * THE TRIGGER FIRES. A record-change condition that never matches (or matches
   * on every save) is invisible to validation and to a metadata test — and a
   * paused run proves the condition matched, while no run proves it did not.
   */
  const harness = () => makeFlowHarness(
    { work_order_csat_followup: WorkOrderCsatFollowupFlow },
    { crm_work_order: [] },
  );

  const completed = (over: Rec = {}): Rec => ({
    id: 'w1', work_order_number: 'WO-1', status: 'completed', owner: 'sup1', ...over,
  });

  it('fires on the transition into completed', async () => {
    const h = harness();
    const runId = await h.trigger('work_order_csat_followup', completed(), { id: 'w1', status: 'in_progress' });
    expect(runId, 'the completion transition did not start the flow').toBeTruthy();
  });

  it('does not fire again on a later save of an already-completed visit', async () => {
    // Without the `previous.status != "completed"` half of the condition, every
    // subsequent edit would re-prompt for the same rating.
    const h = harness();
    const runId = await h.trigger(
      'work_order_csat_followup',
      completed({ customer_feedback: 'Great' }),
      { id: 'w1', status: 'completed' },
    );
    expect(runId).toBeFalsy();
  });

  it('does not fire on a status change that is not a completion', async () => {
    const h = harness();
    const runId = await h.trigger(
      'work_order_csat_followup',
      { id: 'w1', work_order_number: 'WO-1', status: 'dispatched', owner: 'sup1' },
      { id: 'w1', status: 'scheduled' },
    );
    expect(runId).toBeFalsy();
  });

  it('holds the prompt behind the wait rather than sending it immediately', async () => {
    // Asking for a rating the same second the engineer clicks "complete" is the
    // behaviour the `wait` node exists to prevent.
    const h = harness();
    await h.trigger('work_order_csat_followup', completed(), { id: 'w1', status: 'in_progress' });
    expect(h.notifications).toHaveLength(0);
  });
});
