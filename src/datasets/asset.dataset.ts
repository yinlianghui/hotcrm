// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineDataset } from '@objectstack/spec/ui';

/**
 * Installed-base analytics dataset (ADR-0021) — REQ-0002.
 *
 * Answers the two questions a service business runs on: how much equipment is
 * out there, and how much of it we are still on the hook to fix for free.
 */
export const AssetDataset = defineDataset({
  name: 'asset_metrics',
  label: 'Installed Base Metrics',
  description: 'Semantic layer for installed-asset counts, operational state and warranty coverage',
  object: 'crm_asset',

  dimensions: [
    { name: 'status', label: 'Status', field: 'status', type: 'string' },
    // A boolean grouping key: "covered" vs "chargeable" is the split the
    // service P&L is read along.
    { name: 'is_under_warranty', label: 'Under Warranty', field: 'is_under_warranty', type: 'boolean' },
    { name: 'warranty_end_date', label: 'Warranty End', field: 'warranty_end_date', type: 'date' },
  ],

  measures: [
    { name: 'asset_count', label: 'Assets', aggregate: 'count' },
    { name: 'covered_rate', label: 'Warranty Coverage', aggregate: 'avg', field: 'is_under_warranty', format: '0.0%' },
  ],
});
