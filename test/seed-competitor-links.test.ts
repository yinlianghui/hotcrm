// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import stack from '../objectstack.config';
import { OpportunityCompetitorSeedLinks } from '../src/data/index';

/**
 * Guards for the competitor seed catalog and the opportunity↔competitor
 * seed links.
 *
 * The seed loader silently drops ARRAY natural keys on multi-value lookups
 * (objectstack#3911), so the links ride through the
 * `opportunity_seed_competitor_heal` hook instead of the loader. That path
 * only works while three facts hold, none of which `os validate` checks:
 * every linked name resolves to a seeded competitor, the heal hook is
 * registered, and the intent map actually reflects the seed records. Each
 * test below pins one of those facts so a rename or a dropped record fails
 * in CI instead of rendering an empty war-room panel in the demo DB.
 */

type AnyRec = Record<string, any>;
const seeds: AnyRec[] = (stack as any).data ?? [];
const competitorSeed = seeds.find((s) => s.object === 'crm_competitor');
const opportunitySeed = seeds.find((s) => s.object === 'crm_opportunity');
const hooks: AnyRec[] = (stack as any).hooks ?? [];

describe('competitor seed catalog', () => {
  it('seeds six competitors', () => {
    expect(competitorSeed).toBeDefined();
    expect(competitorSeed!.records).toHaveLength(6);
  });

  it('covers every threat level, with at least two high-threat entries', () => {
    const levels = (competitorSeed!.records as AnyRec[]).map((r) => r.threat_level);
    const count = (level: string) => levels.filter((l) => l === level).length;
    expect(count('high')).toBeGreaterThanOrEqual(2);
    expect(count('medium')).toBeGreaterThanOrEqual(1);
    expect(count('low')).toBeGreaterThanOrEqual(1);
  });
});

describe('opportunity↔competitor seed links', () => {
  const competitorNames = new Set(
    (competitorSeed?.records as AnyRec[] | undefined)?.map((r) => r.name) ?? [],
  );
  const linkedRecords = ((opportunitySeed?.records as AnyRec[] | undefined) ?? []).filter(
    (r) => Array.isArray(r.crm_competitors) && r.crm_competitors.length > 0,
  );

  it('every linked competitor name resolves to a seeded competitor', () => {
    for (const record of linkedRecords) {
      for (const name of record.crm_competitors as string[]) {
        expect(competitorNames, `${record.name} → ${name}`).toContain(name);
      }
    }
  });

  it('at least three OPEN opportunities carry links (war-room "engaged deals" data)', () => {
    const open = linkedRecords.filter(
      (r) => r.stage !== 'closed_won' && r.stage !== 'closed_lost',
    );
    expect(open.length).toBeGreaterThanOrEqual(3);
  });

  it('the heal hook is registered for crm_opportunity insert+update', () => {
    const heal = hooks
      .flat()
      .find((h: AnyRec) => h.name === 'opportunity_seed_competitor_heal');
    expect(heal).toBeDefined();
    expect(heal!.object).toBe('crm_opportunity');
    expect(heal!.events).toEqual(expect.arrayContaining(['beforeInsert', 'beforeUpdate']));
  });

  it('the exported intent map mirrors the seed records exactly', () => {
    expect(Object.keys(OpportunityCompetitorSeedLinks).sort()).toEqual(
      linkedRecords.map((r) => r.name as string).sort(),
    );
    for (const record of linkedRecords) {
      expect(OpportunityCompetitorSeedLinks[record.name]).toEqual(record.crm_competitors);
    }
  });
});
