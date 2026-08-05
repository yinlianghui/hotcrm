// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Hook, HookContext } from '@objectstack/spec/data';

/**
 * Asset warranty hook (REQ-0002).
 *
 * Does two jobs, both about keeping "is this machine still covered?" answerable
 * without anyone maintaining it by hand:
 *
 *  1. **Derives the warranty window from the install date.** Field teams record
 *     when a machine went in; they rarely record the warranty dates, and a blank
 *     warranty end silently means "unknown", which downstream reads as
 *     not-billable. A 12-month factory warranty from the install date is the
 *     industry default and is what the field data actually implies.
 *  2. **Materialises `is_under_warranty`.** The flag has to be a real column
 *     because the billable queues filter on it and formula fields cannot be
 *     query predicates (ADR-0072). This hook keeps it right on every write; the
 *     daily `asset_warranty_expiry` flow covers the case where nothing writes
 *     and the coverage simply lapses.
 */

const assetWarrantyDefaults: Hook = {
  name: 'asset_warranty_defaults',
  object: 'crm_asset',
  events: ['beforeInsert', 'beforeUpdate'],
  priority: 200,
  description: 'Derive the warranty window from the install date and keep is_under_warranty current.',
  // Every constant and helper lives INSIDE the handler: a metadata-only body
  // ships the handler source alone, so module-scope references would be out of
  // scope at runtime (see `test/action-sandbox.test.ts`).
  handler: async (ctx: HookContext) => {
    const { input } = ctx;
    const previous = ctx.previous;

    /** `YYYY-MM-DD` for a Date, in UTC — matching how `Field.date()` round-trips. */
    const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

    /**
     * Add whole years to a `YYYY-MM-DD` string.
     *
     * Deliberately NOT `setMonth(+12)`: a 29 Feb install date has no
     * counterpart in a common year, and `Date` silently rolls that forward to
     * 1 March, which reads as a warranty that expires a day late. Clamping to
     * the last valid day of the target month is the behaviour every warranty
     * schedule assumes (the same month-end clamp the task recurrence hook had
     * to learn).
     */
    const addYears = (ymd: string, years: number): string | undefined => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
      if (!m) return undefined;
      const [, y, mo, d] = m;
      const targetYear = Number(y) + years;
      const monthIndex = Number(mo) - 1;
      // Day 0 of the NEXT month is the last day of the target month.
      const lastDay = new Date(Date.UTC(targetYear, monthIndex + 1, 0)).getUTCDate();
      const day = Math.min(Number(d), lastDay);
      return isoDate(new Date(Date.UTC(targetYear, monthIndex, day)));
    };

    /** Default factory warranty when only the install date is known. */
    const DEFAULT_WARRANTY_YEARS = 1;

    /**
     * Effective value of a field for this write: the incoming one, else the
     * stored one — and only when it is a real `YYYY-MM-DD` string the date
     * arithmetic below can actually use.
     */
    const effective = (field: string): string | undefined => {
      const next = input[field];
      if (typeof next === 'string' && next) return next;
      const prev = previous?.[field];
      return typeof prev === 'string' && prev ? prev : undefined;
    };

    /**
     * Is this field already carrying a value, whatever its SHAPE?
     *
     * Deliberately distinct from `effective`. A value can be present and not yet
     * be a string: seed rows arrive with unresolved expression objects
     * (`{ dialect: 'cel', source: 'daysFromNow(330)' }`) which the runtime
     * evaluates AFTER hooks run. Using `effective` for an "is it set?" test
     * therefore reads a populated field as empty, and the hook helpfully
     * overwrites data the caller supplied on purpose.
     */
    const has = (field: string): boolean =>
      input[field] != null || previous?.[field] != null;

    const installDate = effective('install_date');

    // Warranty starts when the machine went in, unless stated otherwise.
    if (installDate && !has('warranty_start_date')) {
      input.warranty_start_date = installDate;
    }

    const warrantyStart = effective('warranty_start_date');
    if (warrantyStart && !has('warranty_end_date')) {
      const end = addYears(warrantyStart, DEFAULT_WARRANTY_YEARS);
      if (end) input.warranty_end_date = end;
    }

    // Materialise coverage. Compared as `YYYY-MM-DD` strings, which sort
    // lexicographically the same way they sort chronologically — no timezone
    // arithmetic, and no dependence on how the driver stores a date column.
    const warrantyEnd = effective('warranty_end_date');
    if (warrantyEnd) {
      input.is_under_warranty = warrantyEnd >= isoDate(new Date());
    } else if (!previous && input.is_under_warranty == null) {
      // A brand-new asset with no coverage dates AND no explicit answer is NOT
      // assumed covered: the field default would otherwise mark every unknown
      // machine free of charge, which is the expensive direction to be wrong in.
      //
      // The `== null` guard is load-bearing, not defensive. Without it the hook
      // overrode a caller who had explicitly said "yes, covered" — including
      // every seeded asset, whose warranty date is still an unresolved
      // expression at this point and so reads as absent. The whole installed
      // base loaded as out of warranty.
      input.is_under_warranty = false;
    }
  },
};

export default [assetWarrantyDefaults];
