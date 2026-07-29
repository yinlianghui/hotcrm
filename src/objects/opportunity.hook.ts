// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Hook, HookContext } from '@objectstack/spec/data';
import type { HookApi } from './_hook-api';
import { OpportunityCompetitorSeedLinks } from '../data/index';

/**
 * Opportunity lifecycle hook.
 *
 * - Re-derives `expected_revenue` from `amount * stageProbability` when either changes.
 * - Freezes most fields after stage is closed (won/lost) — only narrative fields editable.
 * - On `closed_won`: stamps `close_date=today`, promotes the parent account to `customer`,
 *   and asynchronously schedules an "Activate customer" task.
 */

const opportunityValidationHook: Hook = {
  name: 'opportunity_lifecycle',
  object: 'crm_opportunity',
  events: ['beforeInsert', 'beforeUpdate'],
  priority: 200,
  description:
    'Recompute expected_revenue, freeze closed opportunities except narrative fields.',
  handler: async (ctx: HookContext) => {
    // NOTE: L2 hook bodies run *body-only* in a sandbox (QuickJS) — module-level
    // constants are NOT in scope at runtime. These MUST be declared inside the
    // handler or the body throws `ReferenceError` on every write. (See ADR on
    // sandboxed hooks; same pattern as lead.hook.ts.)
    const STAGE_PROBABILITY: Record<string, number> = {
      prospecting: 10,
      qualification: 25,
      needs_analysis: 40,
      proposal: 60,
      negotiation: 80,
      closed_won: 100,
      closed_lost: 0,
    };
    const NARRATIVE_FIELDS = new Set(['description', 'next_step', 'notes']);
    // Framework-managed columns are re-stamped by the runtime itself (ownership
    // reassignment, audit timestamps) — including during post-seed ownership
    // assignment introduced in ObjectStack 9.x. The "freeze closed record" guard
    // must never reject these system writes, only user edits to business fields.
    // (Declared in-handler: sandboxed bodies have no module scope.)
    const SYSTEM_FIELDS = new Set([
      'id', 'owner', 'owner_id', 'created_at', 'updated_at',
      'created_by', 'updated_by', 'space_id', 'organization_id', 'org_id', 'version',
    ]);
    // Stage → forecast category (migrated from the removed
    // `set_forecast_category_by_stage` object workflow — 7.7 dropped workflows[]).
    const STAGE_FORECAST: Record<string, string> = {
      prospecting: 'pipeline',
      qualification: 'pipeline',
      needs_analysis: 'best_case',
      proposal: 'commit',
      negotiation: 'commit',
      closed_won: 'closed',
      closed_lost: 'omitted',
    };

    const { event, input } = ctx;
    const previous = ctx.previous;

    // Freeze closed opportunities — but guard ONLY genuine USER edits. A write
    // with no authenticated user (`ctx.user?.id` absent) is a system / seed /
    // backfill write and must pass: the seed's `close_date: daysAgo(15)`
    // re-evaluates to a new date on every reboot, so a re-seed legitimately
    // changes close_date on already-closed opps. Guarding those threw 23
    // boot-time BodyRunner errors AND blocked the seed from correcting
    // closed-won `probability` to 100 (#459). `ctx.user?.id` is this repo's
    // system-write signal (cf. case/lead/quote hooks) and matches the
    // SYSTEM_FIELDS intent above ("only user edits to business fields").
    // Still runs before the derived-field recompute below so a genuine user
    // edit is judged on the caller's own fields, not injected ones.
    if (event === 'beforeUpdate' && previous && ctx.user?.id) {
      const prevStage = previous.stage as string | undefined;
      const isClosed = prevStage === 'closed_won' || prevStage === 'closed_lost';
      if (isClosed) {
        const violating = Object.keys(input).filter(
          (k) => !NARRATIVE_FIELDS.has(k) && !SYSTEM_FIELDS.has(k) && input[k] !== previous[k],
        );
        if (violating.length > 0) {
          throw new Error(
            `Opportunity is closed (${prevStage}); only ${[...NARRATIVE_FIELDS].join(', ')} may be edited. Attempted: ${violating.join(', ')}.`,
          );
        }
      }
    }

    // Recompute expected_revenue
    const amount =
      typeof input.amount === 'number'
        ? input.amount
        : typeof previous?.amount === 'number'
          ? (previous.amount as number)
          : undefined;
    const stage =
      typeof input.stage === 'string'
        ? input.stage
        : typeof previous?.stage === 'string'
          ? (previous.stage as string)
          : undefined;
    if (typeof amount === 'number' && stage && STAGE_PROBABILITY[stage] !== undefined) {
      input.expected_revenue = Math.round(amount * STAGE_PROBABILITY[stage]) / 100;
    }
    if (stage && STAGE_PROBABILITY[stage] !== undefined) {
      // Always sync probability with stage (single source of truth = stage).
      input.probability = STAGE_PROBABILITY[stage];
    }
    // Sync forecast_category with stage on insert and whenever stage changes.
    if (stage && STAGE_FORECAST[stage] !== undefined) {
      const stageChanged = event === 'beforeInsert' || (typeof input.stage === 'string' && input.stage !== previous?.stage);
      if (stageChanged) input.forecast_category = STAGE_FORECAST[stage];
    }

    if (event === 'beforeUpdate' && previous) {
      // Stamp close_date when transitioning into closed_won
      if (input.stage === 'closed_won' && previous.stage !== 'closed_won' && !input.close_date) {
        input.close_date = new Date().toISOString().slice(0, 10);
      }
    }
  },
};

const opportunityWonHook: Hook = {
  name: 'opportunity_promote_account',
  object: 'crm_opportunity',
  events: ['afterUpdate'],
  priority: 800,
  async: true,
  onError: 'log',
  description:
    'On closed_won: promote linked account to customer and create activation task.',
  handler: async (ctx: HookContext) => {
    const { input } = ctx;
    const previous = ctx.previous;
    const becameWon = input.stage === 'closed_won' && previous?.stage !== 'closed_won';
    if (!becameWon) return;
    const api = ctx.api as HookApi | undefined;
    if (!api) return;

    const accountId =
      (typeof input.crm_account === 'string' && input.crm_account) ||
      (typeof previous?.crm_account === 'string' && previous.crm_account) ||
      undefined;
    if (!accountId) return;

    const account = await api.object('crm_account').findOne({ filter: { id: accountId } });
    if (account && account.type !== 'customer') {
      await api.object('crm_account').update(accountId, { type: 'customer' });
    }

    const oppId = (typeof input.id === 'string' && input.id) || previous?.id;
    const ownerId =
      (typeof input.owner === 'string' && input.owner) ||
      (typeof previous?.owner === 'string' && previous.owner) ||
      ctx.user?.id;
    const due = new Date();
    due.setDate(due.getDate() + 3);
    await api.object('crm_task').insert({
      subject: `Activate new customer for opportunity ${oppId ?? ''}`.trim(),
      status: 'not_started',
      priority: 'high',
      type: 'follow_up',
      due_date: due.toISOString().slice(0, 10),
      owner: ownerId,
      related_to_type: 'crm_opportunity',
      related_to_opportunity: oppId,
      related_to_account: accountId,
    });
  },
};


/**
 * Seed heal: re-inject the competitor links the seed loader drops.
 *
 * SeedLoaderService resolves natural keys only for STRING lookup values — an
 * ARRAY (multi-value lookup like `crm_competitors`) trips its object-value
 * guard and is silently deleted from every seeded write (objectstack#3911,
 * still present in 17.0.0-rc.0). This hook restores the links on system
 * writes (seed/backfill — no ctx.user, same signal as the freeze guard above)
 * by resolving the intended competitor names from the seed-intent map. It
 * no-ops when the record already carries links, so it neither overwrites user
 * edits nor fights the platform once #3911 is fixed — at which point this
 * hook and `OpportunityCompetitorSeedLinks` can be deleted.
 */
const opportunitySeedCompetitorHealHook: Hook = {
  name: 'opportunity_seed_competitor_heal',
  object: 'crm_opportunity',
  events: ['beforeInsert', 'beforeUpdate'],
  description: 'Re-inject seeded competitor links dropped by the seed loader (objectstack#3911).',
  handler: async (ctx: HookContext) => {
    if (ctx.user?.id) return; // user edits own this field; heal only seed/system writes
    const input = ctx.input as Record<string, unknown>;
    const previous = ctx.previous as Record<string, unknown> | undefined;
    const name =
      (typeof input.name === 'string' && input.name) ||
      (typeof previous?.name === 'string' && (previous.name as string)) ||
      undefined;
    if (!name) return;
    const wanted = OpportunityCompetitorSeedLinks[name];
    if (!wanted || wanted.length === 0) return;
    const current = input.crm_competitors ?? previous?.crm_competitors;
    if (Array.isArray(current) && current.length > 0) return; // already linked
    const api = ctx.api as HookApi | undefined;
    if (!api) return;
    // Small catalog — fetch once and match in JS rather than relying on
    // driver-specific filter operators.
    const competitors = await api.object('crm_competitor').find({ fields: ['id', 'name'], top: 100 });
    const idByName = new Map(competitors.map((c) => [String(c.name), String(c.id)]));
    const ids = wanted.map((n) => idByName.get(n)).filter((v): v is string => Boolean(v));
    if (ids.length > 0) input.crm_competitors = ids;
  },
};

export default [opportunityValidationHook, opportunityWonHook, opportunitySeedCompetitorHealHook];
