// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Hook, HookContext } from '@objectstack/spec/data';
import type { HookApi } from './_hook-api';

/**
 * Work-order lifecycle hooks (REQ-0002).
 *
 * `work_order_defaults` (before) owns everything that must be TRUE ON THE
 * RECORD the moment it is saved — the response deadline, the billable flag, the
 * double-booking warning. That placement is the point: the customer asked to be
 * told a visit is chargeable *before* dispatching it ("派单前系统要提醒这单是
 * 收费单"), which only works if the value is computed on save rather than
 * looked up when someone happens to open the record.
 *
 * `work_order_side_effects` (after) owns the writes that land on OTHER records:
 * the asset's repair state and service history, and the account's activity
 * stamp. Keeping them out of the before-hook avoids re-entering this object's
 * own trigger surface.
 */

const workOrderDefaults: Hook = {
  name: 'work_order_defaults',
  object: 'crm_work_order',
  events: ['beforeInsert', 'beforeUpdate'],
  priority: 200,
  description: 'Response SLA, warranty-driven billing, completion stamps and double-booking detection.',
  // Every constant and helper lives INSIDE the handler: a metadata-only body
  // ships the handler source alone, so module-scope references would be out of
  // scope at runtime (see `test/action-sandbox.test.ts`).
  handler: async (ctx: HookContext) => {
    const { input } = ctx;
    const previous = ctx.previous;
    const api = ctx.api as HookApi | undefined;

    /**
     * Response-time promise per priority, in hours.
     *
     * The customer stated two tiers — "紧急的必须 4 小时内有人响应，普通的当天
     * 响应就行" — mapped onto the four-value scale `crm_case` already uses so a
     * supervisor reads one vocabulary across the whole service domain:
     * critical = their "紧急" (4h), medium = their "普通" (same day, 24h).
     *
     * Documented in `src/docs/crm_service.md`; `test/docs-drift.test.ts` pins
     * the prose to these numbers.
     */
    const RESPONSE_HOURS: Record<string, number> = {
      critical: 4,
      high: 8,
      medium: 24,
      low: 72,
    };

    /** Sortable urgency ordinal — see the note on `priority_rank` in the schema. */
    const PRIORITY_RANK: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };

    /** Statuses that mean "this job is off the board" — terminal, not merely done. */
    const TERMINAL_STATUSES = ['closed', 'cancelled'];

    /** Statuses whose work orders no longer occupy an engineer's calendar. */
    const UNSCHEDULED_STATUSES = ['completed', 'closed', 'cancelled'];

    /** Default visit length when dispatch schedules a start but no end. */
    const DEFAULT_VISIT_HOURS = 2;

    /**
     * Read a datetime as epoch milliseconds, whatever shape it arrives in.
     *
     * A `Field.datetime()` reaches this hook as an ISO STRING from the console
     * form and as an epoch-millisecond NUMBER from the SQL driver — the same
     * value, two types. Code that accepts only the string silently treats every
     * driver-read timestamp as absent, which is precisely how the
     * double-booking check came to pass its unit tests (ISO strings) and flag
     * nothing at all against the real database (integers).
     */
    const timeOf = (value: unknown): number | undefined => {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string' && value) {
        const ms = Date.parse(value);
        return Number.isNaN(ms) ? undefined : ms;
      }
      return undefined;
    };

    /** Effective string value for this write: incoming, else stored. */
    const str = (field: string): string | undefined => {
      const next = input[field];
      if (typeof next === 'string' && next) return next;
      const prev = previous?.[field];
      return typeof prev === 'string' && prev ? prev : undefined;
    };

    /**
     * Is this field already carrying a value, whatever its SHAPE?
     *
     * Every "has it been stamped yet?" test below uses this rather than `str`,
     * because a value can be present without being a string: seed rows arrive
     * with unresolved expression objects (`{ dialect: 'cel', source: … }`) that
     * the runtime evaluates AFTER hooks run. Asking `str` whether a timestamp is
     * set reads those as empty, and the hook then overwrites the supplied
     * deadline with one computed from the moment of the load.
     */
    const has = (field: string): boolean =>
      input[field] != null || previous?.[field] != null;

    const status = str('status') ?? 'new';
    const priority = str('priority') ?? 'medium';

    // ─── Priority ordinal ─────────────────────────────────────────────
    // Sorting a queue on the `priority` SELECT compares raw strings and lands
    // medium > low > high > critical — urgency exactly inverted. Every view
    // sorts on this ordinal instead.
    input.priority_rank = PRIORITY_RANK[priority] ?? 2;

    // ─── Response SLA ─────────────────────────────────────────────────
    // The clock is (re)started when the deadline is absent, or when priority
    // actually changes: escalating a job to critical has to pull its deadline
    // in, otherwise the tier means nothing after the first save. An explicitly
    // supplied deadline always wins — dispatch sometimes promises a specific
    // time to the customer.
    const priorityChanged =
      typeof input.priority === 'string' && !!previous && input.priority !== previous.priority;
    const deadlineSupplied = input.response_due_date != null;
    if (!deadlineSupplied && (priorityChanged || !has('response_due_date'))) {
      const hours = RESPONSE_HOURS[priority] ?? RESPONSE_HOURS.medium;
      const due = new Date();
      due.setHours(due.getHours() + hours);
      input.response_due_date = due.toISOString();
    }

    // First move out of `new` is the response.
    if (status !== 'new' && !has('responded_date')) {
      input.responded_date = new Date().toISOString();
    }

    // ─── Status-derived flags and stamps ──────────────────────────────
    // `completed` is deliberately NOT closed: a finished visit still owes
    // billing and the satisfaction call-back. Only `closed`/`cancelled` take
    // the job off the open queues.
    input.is_closed = TERMINAL_STATUSES.includes(status);

    const becameCompleted = input.status === 'completed' && previous?.status !== 'completed';
    if (becameCompleted && !has('completed_date')) {
      input.completed_date = new Date().toISOString();
    }

    // Stamp the acceptance time when the site signs off, whichever half of the
    // signature arrives first.
    const hasSignature = has('signed_by') || has('customer_signature');
    if (hasSignature && !has('signed_date')) {
      input.signed_date = new Date().toISOString();
    }

    // ─── Calendar day of the visit ────────────────────────────────────
    // Materialised from `scheduled_start` because the timeline renderer groups
    // its lanes by a DATE and reads a datetime as no date at all (see the field
    // comment on the schema). Accepts both shapes the value arrives in: an ISO
    // string from the form, and epoch milliseconds from the SQL driver.
    if (!has('scheduled_date')) {
      const startMs = timeOf(input.scheduled_start ?? previous?.scheduled_start);
      if (startMs !== undefined) {
        input.scheduled_date = new Date(startMs).toISOString().slice(0, 10);
      }
    }
    // Clearing the appointment clears the day with it, so a de-scheduled job
    // does not keep a lane on the engineer's board.
    if (input.scheduled_start === null) input.scheduled_date = null;

    // ─── Warranty → billing ───────────────────────────────────────────
    // Resolved from the asset on every save while the job is live. Frozen once
    // the work order is terminal so an asset's warranty lapsing later cannot
    // silently rewrite the billing decision on a job that already went out.
    const wasTerminal = typeof previous?.status === 'string' && TERMINAL_STATUSES.includes(previous.status);
    const assetId = str('crm_asset');
    if (api && assetId && !wasTerminal) {
      const asset = await api.object('crm_asset').findOne({ where: { id: assetId } });
      if (asset) {
        const warrantyEnd = typeof asset.warranty_end_date === 'string' ? asset.warranty_end_date : undefined;
        // Recomputed from the date rather than trusting the asset's cached
        // flag: the flag is only as fresh as the last write to that asset, and
        // this decision costs the customer money.
        const covered = warrantyEnd
          ? warrantyEnd >= new Date().toISOString().slice(0, 10)
          : asset.is_under_warranty === true;
        if (warrantyEnd || typeof asset.is_under_warranty === 'boolean') {
          input.warranty_status = covered ? 'under_warranty' : 'out_of_warranty';
          input.is_billable = !covered;
        }
      }
    } else if (!assetId && !previous) {
      // No asset to judge by. Left as `unknown` rather than guessed — and
      // `is_billable` is left alone so a dispatcher can still mark a visit
      // chargeable by hand.
      if (!input.warranty_status) input.warranty_status = 'unknown';
    }

    // ─── Double-booking detection ─────────────────────────────────────
    // A flag, not a hard rejection: dispatch legitimately stacks two jobs on
    // one industrial park, and a blocking rule would just be worked around by
    // clearing the engineer. Surfaced as a column on the dispatch board.
    //
    // Overlap is computed in JS over a small candidate set rather than pushed
    // into the query, on purpose: datetime range comparisons are the one thing
    // this stack cannot currently trust at the driver level (a `$gte`/`$lte`
    // pair on a datetime column is the defect behind the Service dashboard's
    // missing date picker — see `src/dashboards/service.dashboard.ts`).
    const engineerId = str('assigned_engineer');
    const start = timeOf(input.scheduled_start ?? previous?.scheduled_start);
    if (api && engineerId && start !== undefined) {
      const end = timeOf(input.scheduled_end ?? previous?.scheduled_end)
        ?? start + DEFAULT_VISIT_HOURS * 3_600_000;
      const selfId = typeof input.id === 'string' ? input.id : (previous?.id as string | undefined);

      const candidates = await api.object('crm_work_order').find({
        where: {
          assigned_engineer: engineerId,
          status: { $nin: UNSCHEDULED_STATUSES },
        },
        fields: ['id', 'scheduled_start', 'scheduled_end'],
        top: 200,
      });

      input.has_schedule_conflict = candidates.some((row) => {
        if (selfId && row.id === selfId) return false;
        const otherStart = timeOf(row.scheduled_start);
        if (otherStart === undefined) return false;
        const otherEnd = timeOf(row.scheduled_end) ?? otherStart + DEFAULT_VISIT_HOURS * 3_600_000;
        // Half-open intervals: back-to-back visits do not collide.
        return otherStart < end && start < otherEnd;
      });
    } else {
      input.has_schedule_conflict = false;
    }
  },
};

const workOrderSideEffects: Hook = {
  name: 'work_order_side_effects',
  object: 'crm_work_order',
  events: ['afterUpdate'],
  priority: 800,
  async: true,
  onError: 'log',
  description: 'Roll the visit outcome onto the asset and the account.',
  handler: async (ctx: HookContext) => {
    const { input } = ctx;
    const previous = ctx.previous;
    if (!previous) return;
    const api = ctx.api as HookApi | undefined;
    if (!api) return;

    const statusChanged = typeof input.status === 'string' && input.status !== previous.status;
    if (!statusChanged) return;

    const assetId =
      (typeof input.crm_asset === 'string' && input.crm_asset) ||
      (typeof previous.crm_asset === 'string' && previous.crm_asset) ||
      undefined;
    const accountId =
      (typeof input.crm_account === 'string' && input.crm_account) ||
      (typeof previous.crm_account === 'string' && previous.crm_account) ||
      undefined;

    // Work starting on site puts the machine into repair — this is what makes
    // "which of our installed units are down right now" answerable from the
    // asset list instead of by reading work orders.
    if (input.status === 'in_progress' && assetId) {
      const asset = await api.object('crm_asset').findOne({ where: { id: assetId } });
      if (asset && asset.status === 'installed') {
        await api.object('crm_asset').update(
          { id: assetId, status: 'in_repair' },
          { where: { id: assetId } },
        );
      }
    }

    if (input.status === 'completed') {
      if (assetId) {
        const asset = await api.object('crm_asset').findOne({ where: { id: assetId } });
        const patch: Record<string, unknown> = {
          last_service_date: new Date().toISOString().slice(0, 10),
        };
        // Only the state this work order itself set is reverted; a machine
        // someone decommissioned or suspended meanwhile stays as it is.
        if (asset && asset.status === 'in_repair') patch.status = 'installed';
        await api.object('crm_asset').update(
          { id: assetId, ...patch },
          { where: { id: assetId } },
        );
      }
      if (accountId) {
        await api.object('crm_account').update(
          { id: accountId, last_activity_date: new Date().toISOString().slice(0, 10) },
          { where: { id: accountId } },
        );
      }
    }
  },
};

export default [workOrderDefaults, workOrderSideEffects];
