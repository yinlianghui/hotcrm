// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type * as Automation from '@objectstack/spec/automation';
type Flow = Automation.Flow;

/**
 * Asset warranty expiry — scheduled daily sweep (REQ-0002 ask #5).
 *
 * `asset_warranty_defaults` keeps `is_under_warranty` correct on every WRITE.
 * This flow covers the case that hook cannot: nothing writes, and the coverage
 * simply runs out on a Tuesday. Without it, the billable flag on the next visit
 * would be read from a stale "under warranty" that nobody has touched since the
 * machine was installed — the app would quietly do free work.
 *
 * `warranty_end_date` is a `Field.date()`, so it stays TEXT `YYYY-MM-DD` on both
 * sides of the `$lt` comparison. That matters: the datetime columns are the ones
 * the SQLite path currently mis-compares (see `src/dashboards/service.dashboard.ts`).
 *
 * The notification goes to the ASSET owner rather than to service: a warranty
 * lapsing is a commercial event (an extended-coverage conversation), and it is
 * the account side that acts on it.
 */
export const AssetWarrantyExpiryFlow: Flow = {
  name: 'asset_warranty_expiry',
  label: 'Asset Warranty Expiry',
  description: 'Daily: clear the under-warranty flag on assets whose coverage lapsed and notify the asset owner.',
  type: 'schedule',
  status: 'active',
  // Scheduled runs carry no trigger user; `system` makes the RLS bypass
  // explicit and intended (ADR-0049, #1888).
  runAs: 'system',

  variables: [],

  nodes: [
    { id: 'start', type: 'start', label: 'Start (daily 01:00)', config: { schedule: '0 1 * * *' } },
    {
      id: 'query_lapsed', type: 'get_record', label: 'Find Lapsed Warranties',
      config: {
        objectName: 'crm_asset',
        filter: {
          is_under_warranty: true,
          warranty_end_date: { $lt: '{TODAY()}' },
          status: { $nin: ['decommissioned'] },
        },
        limit: 500,
        outputVariable: 'assetList',
      },
    },
    {
      id: 'loop_assets', type: 'loop', label: 'For Each Lapsed Asset',
      config: {
        collection: '{assetList}',
        iteratorVariable: 'currentAsset',
        body: {
          nodes: [
            {
              // Per-record update inside the loop: `update_record` calls
              // `data.update()` without `options.multi`, so a filter matching
              // more than one row fails at runtime ("Update requires an ID or
              // options.multi=true") — invisible to build and validate.
              id: 'clear_warranty', type: 'update_record', label: 'Clear Warranty Flag',
              config: {
                objectName: 'crm_asset',
                filter: { id: '{currentAsset.id}' },
                fields: { is_under_warranty: false },
              },
            },
            {
              id: 'notify_owner', type: 'notify', label: 'Notify Asset Owner',
              config: {
                // Owner only — a lookup dot-walk interpolates to the literal
                // "undefined" in flow templates.
                to: ['{currentAsset.owner}'],
                channels: ['inbox'],
                topic: 'asset_warranty_expired',
                title: 'Warranty expired: {currentAsset.asset_number}',
                body: 'Asset {currentAsset.name} is out of warranty. Future service visits are chargeable — consider an extended service contract.',
                actionUrl: '/crm_asset/{currentAsset.id}',
              },
            },
          ],
          edges: [
            { id: 'b1', source: 'clear_warranty', target: 'notify_owner', type: 'default' },
          ],
        },
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],

  edges: [
    { id: 'e1', source: 'start', target: 'query_lapsed', type: 'default' },
    { id: 'e2', source: 'query_lapsed', target: 'loop_assets', type: 'default' },
    { id: 'e3', source: 'loop_assets', target: 'end', type: 'default' },
  ],
};
