// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import assetHooks from '../src/objects/asset.hook';
import workOrderHooks from '../src/objects/work_order.hook';
import {
  makeHarness, makeDeniedApi, makeCtx, hookNamed, today, daysFromNow, type Rec,
} from './helpers/hook-harness';

/**
 * Runtime tests for the FIELD-SERVICE hooks (REQ-0002) — real handler bodies
 * against a controllable in-memory data layer.
 *
 * Companion files: hooks-runtime-service.test.ts (case, contract, task, …) and
 * hooks-runtime-sales.test.ts.
 *
 * Three behaviours here are load-bearing for the customer's actual ask and none
 * of them is visible to metadata validation:
 *
 *   • the response deadline derived from priority (their "紧急 4 小时 /
 *     普通 当天"),
 *   • the billable flag derived from the ASSET's warranty, computed on save so
 *     it is on the record BEFORE anyone is dispatched,
 *   • double-booking detection across an engineer's other visits.
 */

const USER = { id: 'user_1' };

/** ISO timestamp `hours` from now (negative for the past). */
const hoursFromNow = (hours: number): string =>
  new Date(Date.now() + hours * 3_600_000).toISOString();

// ─────────────────────────────────────────────────────────────── asset ──

describe('asset_warranty_defaults', () => {
  const hook = hookNamed(assetHooks, 'asset_warranty_defaults');

  it('derives the warranty window from the install date', async () => {
    const input: Rec = { name: 'Line 2 press', install_date: '2026-03-11' };
    await hook.handler(makeCtx({ event: 'beforeInsert', input, user: USER }));
    expect(input.warranty_start_date).toBe('2026-03-11');
    // Default factory warranty is 12 months.
    expect(input.warranty_end_date).toBe('2027-03-11');
  });

  it('clamps a 29 February install to the last valid day of the target month', async () => {
    // `setMonth(+12)` rolls 29 Feb forward to 1 March in a common year, which
    // reads as a warranty that expires a day late.
    const input: Rec = { name: 'Leap unit', install_date: '2028-02-29' };
    await hook.handler(makeCtx({ event: 'beforeInsert', input, user: USER }));
    expect(input.warranty_end_date).toBe('2029-02-28');
  });

  it('never overwrites explicitly supplied warranty dates', async () => {
    // An extended-coverage deal is authored by hand; the default must not win.
    const input: Rec = {
      name: 'Extended unit',
      install_date: '2026-01-01',
      warranty_start_date: '2026-01-01',
      warranty_end_date: '2029-01-01',
    };
    await hook.handler(makeCtx({ event: 'beforeInsert', input, user: USER }));
    expect(input.warranty_end_date).toBe('2029-01-01');
  });

  it('materialises is_under_warranty from the end date, in both directions', async () => {
    const covered: Rec = { name: 'Covered', warranty_end_date: daysFromNow(30) };
    await hook.handler(makeCtx({ event: 'beforeInsert', input: covered, user: USER }));
    expect(covered.is_under_warranty).toBe(true);

    const lapsed: Rec = { name: 'Lapsed', warranty_end_date: daysFromNow(-30) };
    await hook.handler(makeCtx({ event: 'beforeInsert', input: lapsed, user: USER }));
    expect(lapsed.is_under_warranty).toBe(false);
  });

  it('treats coverage ending today as still covered', async () => {
    // The boundary decides whether a visit today is free or chargeable, so it
    // is authored rather than left to whichever way the comparison happened
    // to fall.
    const input: Rec = { name: 'Expiring today', warranty_end_date: today() };
    await hook.handler(makeCtx({ event: 'beforeInsert', input, user: USER }));
    expect(input.is_under_warranty).toBe(true);
  });

  it('does not assume coverage for a new asset with no dates at all', async () => {
    // The field default is `true`; leaving it there would mark every unknown
    // machine free of charge, which is the expensive direction to be wrong in.
    const input: Rec = { name: 'Unknown provenance' };
    await hook.handler(makeCtx({ event: 'beforeInsert', input, user: USER }));
    expect(input.is_under_warranty).toBe(false);
  });

  it('recomputes coverage on update from the STORED end date', async () => {
    // A write that touches only the name must not silently re-open a lapsed
    // warranty (nor close a live one).
    const input: Rec = { name: 'Renamed' };
    const previous: Rec = { id: 'a1', name: 'Old', warranty_end_date: daysFromNow(-5), is_under_warranty: true };
    await hook.handler(makeCtx({ event: 'beforeUpdate', input, previous, user: USER }));
    expect(input.is_under_warranty).toBe(false);
  });
});

/**
 * Values that are PRESENT but not yet a string.
 *
 * Seed rows reach the hooks carrying unresolved expression objects — the
 * runtime evaluates `cel\`daysFromNow(330)\`` only after the before-hooks have
 * run. A hook that tests "is this set?" by asking for a string reads every one
 * of them as empty and overwrites data the caller supplied deliberately.
 *
 * This is not hypothetical: it shipped, and the first boot loaded the entire
 * seeded installed base as OUT of warranty (and every work order with a
 * response deadline recomputed from the moment of the load). Both halves are
 * pinned below.
 */
describe('hooks respect values supplied as unresolved expressions', () => {
  const cel = (source: string) => ({ dialect: 'cel', source });

  it('keeps a seeded asset’s explicit coverage answer', async () => {
    const hook = hookNamed(assetHooks, 'asset_warranty_defaults');
    const input: Rec = {
      name: 'Seeded unit',
      install_date: cel('daysAgo(400)'),
      warranty_start_date: cel('daysAgo(400)'),
      warranty_end_date: cel('daysFromNow(330)'),
      is_under_warranty: true,
    };
    await hook.handler(makeCtx({ event: 'beforeInsert', input, user: USER }));
    expect(input.is_under_warranty, 'the whole installed base loaded as out of warranty').toBe(true);
  });

  it('does not overwrite a warranty window that is still an expression', async () => {
    const hook = hookNamed(assetHooks, 'asset_warranty_defaults');
    const end = cel('daysFromNow(330)');
    const input: Rec = {
      name: 'Seeded unit',
      install_date: cel('daysAgo(400)'),
      warranty_end_date: end,
      is_under_warranty: true,
    };
    await hook.handler(makeCtx({ event: 'beforeInsert', input, user: USER }));
    expect(input.warranty_end_date).toBe(end);
  });

  it('keeps a work order’s supplied response deadline', async () => {
    const hook = hookNamed(workOrderHooks, 'work_order_defaults');
    const due = cel('daysAgo(1)');
    const input: Rec = { status: 'new', priority: 'low', response_due_date: due };
    await hook.handler(makeCtx({ event: 'beforeInsert', input, user: USER }));
    expect(input.response_due_date, 'a seeded deadline was recomputed from load time').toBe(due);
  });

  it('keeps a work order’s supplied response timestamp', async () => {
    const hook = hookNamed(workOrderHooks, 'work_order_defaults');
    const responded = cel('daysAgo(1)');
    const input: Rec = { status: 'scheduled', priority: 'high', responded_date: responded };
    await hook.handler(makeCtx({ event: 'beforeInsert', input, user: USER }));
    expect(input.responded_date).toBe(responded);
  });

  it('still stamps what genuinely is missing', async () => {
    // The guard must not turn into "never stamp anything".
    const hook = hookNamed(workOrderHooks, 'work_order_defaults');
    const input: Rec = { status: 'scheduled', priority: 'high' };
    await hook.handler(makeCtx({ event: 'beforeInsert', input, user: USER }));
    expect(input.response_due_date).toBeTruthy();
    expect(input.responded_date).toBeTruthy();
  });
});

// ────────────────────────────────────────────────────────── work order ──

describe('work_order_defaults — response SLA', () => {
  const hook = hookNamed(workOrderHooks, 'work_order_defaults');

  it('materialises priority_rank so dispatch queues sort by urgency', async () => {
    // Sorting on the `priority` select compares raw strings and lands
    // medium > low > high > critical — urgency exactly inverted.
    for (const [priority, rank] of [['low', 1], ['medium', 2], ['high', 3], ['critical', 4]] as const) {
      const input: Rec = { priority, status: 'new' };
      await hook.handler(makeCtx({ event: 'beforeInsert', input, user: USER }));
      expect(input.priority_rank).toBe(rank);
    }
  });

  it('promises the customer 4 hours on a critical job and 24 on a medium one', async () => {
    // REQ-0002: "紧急的必须 4 小时内有人响应，普通的当天响应就行".
    for (const [priority, hours] of [['critical', 4], ['high', 8], ['medium', 24], ['low', 72]] as const) {
      const input: Rec = { priority, status: 'new' };
      const before = Date.now();
      await hook.handler(makeCtx({ event: 'beforeInsert', input, user: USER }));
      const due = new Date(input.response_due_date as string).getTime();
      expect(due, `${priority} deadline`).toBeGreaterThan(before + (hours - 0.1) * 3_600_000);
      expect(due, `${priority} deadline`).toBeLessThan(before + (hours + 0.1) * 3_600_000);
    }
  });

  it('honours a deadline dispatch promised explicitly', async () => {
    const promised = hoursFromNow(2);
    const input: Rec = { priority: 'low', status: 'new', response_due_date: promised };
    await hook.handler(makeCtx({ event: 'beforeInsert', input, user: USER }));
    expect(input.response_due_date).toBe(promised);
  });

  it('pulls the deadline in when a job is escalated to critical', async () => {
    // Without this, the urgency tier means nothing after the first save.
    const input: Rec = { priority: 'critical' };
    const previous: Rec = { id: 'w1', priority: 'low', status: 'new', response_due_date: hoursFromNow(70) };
    const before = Date.now();
    await hook.handler(makeCtx({ event: 'beforeUpdate', input, previous, user: USER }));
    const due = new Date(input.response_due_date as string).getTime();
    expect(due).toBeLessThan(before + 4.1 * 3_600_000);
  });

  it('leaves the deadline alone on an unrelated update', async () => {
    const original = hoursFromNow(20);
    const input: Rec = { internal_notes: 'called the site' };
    const previous: Rec = { id: 'w1', priority: 'medium', status: 'scheduled', response_due_date: original, responded_date: hoursFromNow(-1) };
    await hook.handler(makeCtx({ event: 'beforeUpdate', input, previous, user: USER }));
    expect(input.response_due_date).toBeUndefined();
  });

  it('stamps responded_date the moment the job leaves `new`', async () => {
    const input: Rec = { status: 'scheduled' };
    const previous: Rec = { id: 'w1', status: 'new', priority: 'medium', response_due_date: hoursFromNow(10) };
    await hook.handler(makeCtx({ event: 'beforeUpdate', input, previous, user: USER }));
    expect(input.responded_date).toBeTruthy();
  });

  it('does not re-stamp responded_date on later saves', async () => {
    const first = hoursFromNow(-5);
    const input: Rec = { status: 'in_progress' };
    const previous: Rec = { id: 'w1', status: 'dispatched', priority: 'medium', responded_date: first, response_due_date: hoursFromNow(2) };
    await hook.handler(makeCtx({ event: 'beforeUpdate', input, previous, user: USER }));
    expect(input.responded_date).toBeUndefined();
  });
});

describe('work_order_defaults — status flags and completion stamps', () => {
  const hook = hookNamed(workOrderHooks, 'work_order_defaults');

  it('treats only closed and cancelled as closed — a completed visit still owes billing and CSAT', async () => {
    for (const [status, closed] of [
      ['new', false], ['scheduled', false], ['dispatched', false], ['in_progress', false],
      ['on_hold', false], ['completed', false], ['closed', true], ['cancelled', true],
    ] as const) {
      const input: Rec = { status, priority: 'medium' };
      await hook.handler(makeCtx({ event: 'beforeInsert', input, user: USER }));
      expect(input.is_closed, `is_closed for ${status}`).toBe(closed);
    }
  });

  it('stamps completed_date on the transition into completed', async () => {
    const input: Rec = { status: 'completed', work_performed: 'Replaced the fan tray' };
    const previous: Rec = { id: 'w1', status: 'in_progress', priority: 'medium', response_due_date: hoursFromNow(-1), responded_date: hoursFromNow(-2) };
    await hook.handler(makeCtx({ event: 'beforeUpdate', input, previous, user: USER }));
    expect(input.completed_date).toBeTruthy();
  });

  it('does not re-stamp completed_date on a later edit of a completed visit', async () => {
    const original = hoursFromNow(-48);
    const input: Rec = { customer_rating: 5 };
    const previous: Rec = { id: 'w1', status: 'completed', priority: 'medium', completed_date: original, responded_date: hoursFromNow(-50), response_due_date: hoursFromNow(-52) };
    await hook.handler(makeCtx({ event: 'beforeUpdate', input, previous, user: USER }));
    expect(input.completed_date).toBeUndefined();
  });

  it('stamps signed_date when the site accepts the work', async () => {
    const input: Rec = { status: 'completed', signed_by: 'John Smith', work_performed: 'Recalibrated' };
    const previous: Rec = { id: 'w1', status: 'in_progress', priority: 'medium', responded_date: hoursFromNow(-3), response_due_date: hoursFromNow(-4) };
    await hook.handler(makeCtx({ event: 'beforeUpdate', input, previous, user: USER }));
    expect(input.signed_date).toBeTruthy();
  });
});

describe('work_order_defaults — warranty drives billing', () => {
  const hook = hookNamed(workOrderHooks, 'work_order_defaults');

  const withAssets = () => makeHarness({
    crm_asset: [
      { id: 'a_covered', name: 'Covered unit', warranty_end_date: daysFromNow(120), is_under_warranty: true },
      { id: 'a_lapsed', name: 'Lapsed unit', warranty_end_date: daysFromNow(-60), is_under_warranty: false },
      // The dangerous one: the cached flag still says covered, but the date
      // says otherwise. The hook must believe the date.
      { id: 'a_stale', name: 'Stale flag unit', warranty_end_date: daysFromNow(-1), is_under_warranty: true },
      { id: 'a_unknown', name: 'No dates' },
    ],
  });

  it('marks a visit to an in-warranty asset free', async () => {
    const h = withAssets();
    const input: Rec = { status: 'new', priority: 'medium', crm_asset: 'a_covered' };
    await hook.handler(makeCtx({ event: 'beforeInsert', input, user: USER, api: h.api }));
    expect(input.warranty_status).toBe('under_warranty');
    expect(input.is_billable).toBe(false);
  });

  it('marks a visit to an out-of-warranty asset billable BEFORE dispatch', async () => {
    // The whole point of computing this on save: the charge is on the record
    // while the job is still `new`, not discovered after the engineer arrives.
    const h = withAssets();
    const input: Rec = { status: 'new', priority: 'medium', crm_asset: 'a_lapsed' };
    await hook.handler(makeCtx({ event: 'beforeInsert', input, user: USER, api: h.api }));
    expect(input.warranty_status).toBe('out_of_warranty');
    expect(input.is_billable).toBe(true);
  });

  it('trusts the warranty DATE over a stale cached flag', async () => {
    const h = withAssets();
    const input: Rec = { status: 'new', priority: 'medium', crm_asset: 'a_stale' };
    await hook.handler(makeCtx({ event: 'beforeInsert', input, user: USER, api: h.api }));
    expect(input.warranty_status).toBe('out_of_warranty');
    expect(input.is_billable).toBe(true);
  });

  it('says unknown rather than guessing when no asset is linked', async () => {
    const h = withAssets();
    const input: Rec = { status: 'new', priority: 'medium' };
    await hook.handler(makeCtx({ event: 'beforeInsert', input, user: USER, api: h.api }));
    expect(input.warranty_status).toBe('unknown');
    // Not forced either way — a dispatcher can still mark it chargeable.
    expect(input.is_billable).toBeUndefined();
  });

  it('freezes the billing decision once the work order is terminal', async () => {
    // A warranty lapsing later must not rewrite the commercial terms of a job
    // that already went out and was closed.
    const h = withAssets();
    const input: Rec = { internal_notes: 'archived' };
    const previous: Rec = {
      id: 'w1', status: 'closed', priority: 'medium', crm_asset: 'a_lapsed',
      warranty_status: 'under_warranty', is_billable: false,
      responded_date: hoursFromNow(-99), response_due_date: hoursFromNow(-100),
    };
    await hook.handler(makeCtx({ event: 'beforeUpdate', input, previous, user: USER, api: h.api }));
    expect(input.warranty_status).toBeUndefined();
    expect(input.is_billable).toBeUndefined();
  });

  it('survives a permission-denied read instead of rejecting the write', async () => {
    const input: Rec = { status: 'new', priority: 'medium', crm_asset: 'a_covered' };
    await expect(
      hook.handler(makeCtx({ event: 'beforeInsert', input, user: USER, api: makeDeniedApi() })),
    ).rejects.toThrow();
    // Documented behaviour: the read is not swallowed. A billing decision made
    // from data the caller cannot see would be worse than a failed save.
  });
});

describe('work_order_defaults — double booking', () => {
  const hook = hookNamed(workOrderHooks, 'work_order_defaults');

  const engineerWith = (rows: Rec[]) => makeHarness({ crm_work_order: rows });

  it('flags an overlap with the same engineer’s other visit', async () => {
    const h = engineerWith([
      {
        id: 'w_other', assigned_engineer: 'eng1', status: 'scheduled',
        scheduled_start: hoursFromNow(24), scheduled_end: hoursFromNow(28),
      },
    ]);
    const input: Rec = {
      status: 'scheduled', priority: 'medium', assigned_engineer: 'eng1',
      scheduled_start: hoursFromNow(26), scheduled_end: hoursFromNow(30),
    };
    await hook.handler(makeCtx({ event: 'beforeInsert', input, user: USER, api: h.api }));
    expect(input.has_schedule_conflict).toBe(true);
  });

  it('does not flag back-to-back visits', async () => {
    // Half-open intervals: finishing at 12:00 and starting at 12:00 is a full
    // day's work, not a conflict.
    const h = engineerWith([
      {
        id: 'w_other', assigned_engineer: 'eng1', status: 'scheduled',
        scheduled_start: hoursFromNow(24), scheduled_end: hoursFromNow(26),
      },
    ]);
    const input: Rec = {
      status: 'scheduled', priority: 'medium', assigned_engineer: 'eng1',
      scheduled_start: hoursFromNow(26), scheduled_end: hoursFromNow(28),
    };
    await hook.handler(makeCtx({ event: 'beforeInsert', input, user: USER, api: h.api }));
    expect(input.has_schedule_conflict).toBe(false);
  });

  it('flags an overlap when the driver hands timestamps back as epoch milliseconds', async () => {
    // The shape that made this check pass its tests and do nothing in
    // production: the console form sends ISO strings, the SQL driver returns
    // integers, and a string-only reader treats every stored visit as absent.
    // Both the record under test and its neighbour are numbers here.
    const h = engineerWith([
      {
        id: 'w_other', assigned_engineer: 'eng1', status: 'scheduled',
        scheduled_start: Date.now() + 24 * 3_600_000,
        scheduled_end: Date.now() + 28 * 3_600_000,
      },
    ]);
    const input: Rec = {
      status: 'scheduled', priority: 'medium', assigned_engineer: 'eng1',
      scheduled_start: Date.now() + 26 * 3_600_000,
      scheduled_end: Date.now() + 30 * 3_600_000,
    };
    await hook.handler(makeCtx({ event: 'beforeInsert', input, user: USER, api: h.api }));
    expect(input.has_schedule_conflict).toBe(true);
  });

  it('does not flag a different engineer at the same time', async () => {
    const h = engineerWith([
      {
        id: 'w_other', assigned_engineer: 'eng2', status: 'scheduled',
        scheduled_start: hoursFromNow(24), scheduled_end: hoursFromNow(28),
      },
    ]);
    const input: Rec = {
      status: 'scheduled', priority: 'medium', assigned_engineer: 'eng1',
      scheduled_start: hoursFromNow(25), scheduled_end: hoursFromNow(27),
    };
    await hook.handler(makeCtx({ event: 'beforeInsert', input, user: USER, api: h.api }));
    expect(input.has_schedule_conflict).toBe(false);
  });

  it('ignores finished and cancelled visits when looking for a clash', async () => {
    const h = engineerWith([
      { id: 'w_done', assigned_engineer: 'eng1', status: 'completed', scheduled_start: hoursFromNow(24), scheduled_end: hoursFromNow(28) },
      { id: 'w_gone', assigned_engineer: 'eng1', status: 'cancelled', scheduled_start: hoursFromNow(24), scheduled_end: hoursFromNow(28) },
    ]);
    const input: Rec = {
      status: 'scheduled', priority: 'medium', assigned_engineer: 'eng1',
      scheduled_start: hoursFromNow(25), scheduled_end: hoursFromNow(27),
    };
    await hook.handler(makeCtx({ event: 'beforeInsert', input, user: USER, api: h.api }));
    expect(input.has_schedule_conflict).toBe(false);
  });

  it('never flags a record against itself when its schedule is edited', async () => {
    const h = engineerWith([
      {
        id: 'w1', assigned_engineer: 'eng1', status: 'scheduled',
        scheduled_start: hoursFromNow(24), scheduled_end: hoursFromNow(28),
      },
    ]);
    const input: Rec = { scheduled_end: hoursFromNow(30) };
    const previous: Rec = {
      id: 'w1', assigned_engineer: 'eng1', status: 'scheduled', priority: 'medium',
      scheduled_start: hoursFromNow(24), scheduled_end: hoursFromNow(28),
      responded_date: hoursFromNow(-1), response_due_date: hoursFromNow(4),
    };
    await hook.handler(makeCtx({ event: 'beforeUpdate', input, previous, user: USER, api: h.api }));
    expect(input.has_schedule_conflict).toBe(false);
  });

  it('assumes a default visit length when dispatch gives only a start', async () => {
    const h = engineerWith([
      { id: 'w_other', assigned_engineer: 'eng1', status: 'dispatched', scheduled_start: hoursFromNow(24) },
    ]);
    const input: Rec = {
      status: 'scheduled', priority: 'medium', assigned_engineer: 'eng1',
      scheduled_start: hoursFromNow(25),
    };
    await hook.handler(makeCtx({ event: 'beforeInsert', input, user: USER, api: h.api }));
    expect(input.has_schedule_conflict).toBe(true);
  });

  it('materialises the calendar day the engineer timeline groups by', async () => {
    // The timeline renderer reads a `Field.datetime()` as no date at all, so
    // every visit collapses into one "no date" lane. The derived date column is
    // what gives the board its lanes back.
    const h = engineerWith([]);
    const input: Rec = {
      status: 'scheduled', priority: 'medium', assigned_engineer: 'eng1',
      scheduled_start: '2026-08-03T09:30:00.000Z',
    };
    await hook.handler(makeCtx({ event: 'beforeInsert', input, user: USER, api: h.api }));
    expect(input.scheduled_date).toBe('2026-08-03');
  });

  it('derives the day from epoch milliseconds too', async () => {
    // The SQL driver hands datetimes back as integers, not ISO strings.
    const h = engineerWith([]);
    const input: Rec = {
      status: 'scheduled', priority: 'medium', assigned_engineer: 'eng1',
      scheduled_start: Date.parse('2026-08-03T09:30:00.000Z'),
    };
    await hook.handler(makeCtx({ event: 'beforeInsert', input, user: USER, api: h.api }));
    expect(input.scheduled_date).toBe('2026-08-03');
  });

  it('drops the day when the appointment is cleared', async () => {
    const h = engineerWith([]);
    const input: Rec = { scheduled_start: null };
    const previous: Rec = {
      id: 'w1', status: 'scheduled', priority: 'medium',
      scheduled_start: '2026-08-03T09:30:00.000Z', scheduled_date: '2026-08-03',
      responded_date: '2026-08-01T00:00:00.000Z', response_due_date: '2026-08-02T00:00:00.000Z',
    };
    await hook.handler(makeCtx({ event: 'beforeUpdate', input, previous, user: USER, api: h.api }));
    expect(input.scheduled_date).toBeNull();
  });

  it('clears the flag when the engineer or the schedule is removed', async () => {
    const h = engineerWith([]);
    const input: Rec = { status: 'new', priority: 'medium', assigned_engineer: null };
    await hook.handler(makeCtx({ event: 'beforeInsert', input, user: USER, api: h.api }));
    expect(input.has_schedule_conflict).toBe(false);
  });
});

describe('work_order_side_effects', () => {
  const hook = hookNamed(workOrderHooks, 'work_order_side_effects');

  const store = () => makeHarness({
    crm_asset: [{ id: 'a1', name: 'Line 2 press', status: 'installed' }],
    crm_account: [{ id: 'acc1', name: 'Acme', last_activity_date: '2020-01-01' }],
  });

  it('puts the machine into repair when work starts on site', async () => {
    const h = store();
    const input: Rec = { id: 'w1', status: 'in_progress', crm_asset: 'a1', crm_account: 'acc1' };
    const previous: Rec = { id: 'w1', status: 'dispatched', crm_asset: 'a1', crm_account: 'acc1' };
    await hook.handler(makeCtx({ event: 'afterUpdate', input, previous, user: USER, api: h.api }));
    expect(h.store.crm_asset[0].status).toBe('in_repair');
  });

  it('returns the machine to service and stamps its service history on completion', async () => {
    const h = makeHarness({
      crm_asset: [{ id: 'a1', name: 'Line 2 press', status: 'in_repair' }],
      crm_account: [{ id: 'acc1', name: 'Acme' }],
    });
    const input: Rec = { id: 'w1', status: 'completed', crm_asset: 'a1', crm_account: 'acc1' };
    const previous: Rec = { id: 'w1', status: 'in_progress', crm_asset: 'a1', crm_account: 'acc1' };
    await hook.handler(makeCtx({ event: 'afterUpdate', input, previous, user: USER, api: h.api }));
    expect(h.store.crm_asset[0].status).toBe('installed');
    expect(h.store.crm_asset[0].last_service_date).toBe(today());
    expect(h.store.crm_account[0].last_activity_date).toBe(today());
  });

  it('does not resurrect a machine somebody decommissioned meanwhile', async () => {
    // Only the state this work order itself set is reverted.
    const h = makeHarness({
      crm_asset: [{ id: 'a1', name: 'Old unit', status: 'decommissioned' }],
      crm_account: [{ id: 'acc1', name: 'Acme' }],
    });
    const input: Rec = { id: 'w1', status: 'completed', crm_asset: 'a1', crm_account: 'acc1' };
    const previous: Rec = { id: 'w1', status: 'in_progress', crm_asset: 'a1', crm_account: 'acc1' };
    await hook.handler(makeCtx({ event: 'afterUpdate', input, previous, user: USER, api: h.api }));
    expect(h.store.crm_asset[0].status).toBe('decommissioned');
    // The service history is still recorded — the visit did happen.
    expect(h.store.crm_asset[0].last_service_date).toBe(today());
  });

  it('does nothing when the status did not change', async () => {
    // Guards against re-entering the trigger surface on every unrelated save.
    const h = store();
    const input: Rec = { id: 'w1', status: 'dispatched', internal_notes: 'called ahead', crm_asset: 'a1' };
    const previous: Rec = { id: 'w1', status: 'dispatched', crm_asset: 'a1' };
    await hook.handler(makeCtx({ event: 'afterUpdate', input, previous, user: USER, api: h.api }));
    expect(h.calls).toEqual([]);
  });

  it('is inert on insert-shaped contexts with no previous state', async () => {
    const h = store();
    const input: Rec = { id: 'w1', status: 'completed', crm_asset: 'a1' };
    await hook.handler(makeCtx({ event: 'afterUpdate', input, user: USER, api: h.api }));
    expect(h.calls).toEqual([]);
  });
});
