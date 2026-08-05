// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineView } from '@objectstack/spec/ui';

/**
 * Asset (installed base) Views — REQ-0002.
 *
 *   • grid     — the installed base, warranty-first
 *   • kanban   — units grouped by their operational state
 *   • map      — where the machines physically are (site_location)
 *   • calendar — warranty expiries, so renewals can be worked ahead of time
 *   • lists    — out-of-warranty, under repair, mine
 */
export const AssetViews = defineView({
  list: {
    type: 'grid',
    name: 'all_assets',
    label: 'All Assets',
    data: { provider: 'object', object: 'crm_asset' },
    columns: [
      { field: 'asset_number', width: 130, sortable: true, link: true, pinned: 'left' },
      { field: 'name', width: 220, sortable: true },
      { field: 'crm_account', width: 180 },
      { field: 'crm_product', width: 170 },
      { field: 'serial_number', width: 150 },
      { field: 'status', width: 140, sortable: true },
      { field: 'install_date', width: 130, sortable: true },
      { field: 'warranty_end_date', width: 140, sortable: true },
      { field: 'is_under_warranty', width: 130, align: 'center' },
      { field: 'last_service_date', width: 140, sortable: true },
    ],
    // Soonest-expiring coverage first — the queue a renewals conversation
    // actually starts from.
    sort: [{ field: 'warranty_end_date', order: 'asc' }],
    rowColor: {
      field: 'status',
      colors: {
        installed: '#16a34a',
        in_repair: '#f97316',
        suspended: '#eab308',
        decommissioned: '#94a3b8',
      },
    },
    selection: { type: 'multiple' },
    pagination: { pageSize: 50 },
    exportOptions: ['csv', 'xlsx'],
    appearance: {
      showDescription: true,
      allowedVisualizations: ['grid', 'kanban', 'map', 'calendar'],
    },
    tabs: [
      { name: 'all', label: 'All', view: 'all_assets', isDefault: true, pinned: true },
      { name: 'fleet', label: 'Fleet Status', icon: 'columns-3', view: 'asset_fleet_board' },
      { name: 'map', label: 'Map', icon: 'map', view: 'asset_map' },
      { name: 'warranty', label: 'Warranty Expiry', icon: 'calendar', view: 'asset_warranty_calendar' },
      { name: 'out_of_warranty', label: 'Out of Warranty', icon: 'badge-dollar-sign', view: 'assets_out_of_warranty' },
      { name: 'in_repair', label: 'Under Repair', icon: 'wrench', view: 'assets_in_repair' },
      { name: 'mine', label: 'My Assets', icon: 'user', view: 'my_assets' },
    ],
    // No `rowActions`: the legacy surface only dispatches defined stack
    // actions, and row edit is built in ('edit' is not a defined action).
  },

  listViews: {
    /** Operational state of the installed fleet */
    asset_fleet_board: {
      name: 'asset_fleet_board',
      type: 'kanban',
      label: 'Fleet Status',
      data: { provider: 'object', object: 'crm_asset' },
      columns: ['asset_number', 'name', 'crm_account', 'warranty_end_date'],
      kanban: {
        groupByField: 'status',
        columns: ['name', 'crm_account', 'serial_number', 'warranty_end_date'],
      },
      navigation: { mode: 'drawer', width: '640px' },
    },

    /** Where the machines are — drives route planning conversations */
    asset_map: {
      name: 'asset_map',
      type: 'map',
      label: 'Assets by Location',
      data: { provider: 'object', object: 'crm_asset' },
      columns: ['name', 'crm_account', 'site_location', 'site_address'],
    },

    /**
     * Warranty expiries on a calendar. `warranty_end_date` is a `Field.date()`,
     * which stays TEXT `YYYY-MM-DD` on both sides of a comparison — unlike the
     * datetime columns that cannot currently be windowed on the SQLite path
     * (see `src/dashboards/service.dashboard.ts`).
     */
    asset_warranty_calendar: {
      name: 'asset_warranty_calendar',
      type: 'calendar',
      label: 'Warranty Expiry Calendar',
      data: { provider: 'object', object: 'crm_asset' },
      columns: ['asset_number', 'name', 'crm_account'],
      calendar: {
        startDateField: 'warranty_end_date',
        titleField: 'name',
        colorField: 'status',
      },
    },

    /** The chargeable installed base — every visit here is billable */
    assets_out_of_warranty: {
      name: 'assets_out_of_warranty',
      type: 'grid',
      label: '💰 Out of Warranty',
      data: { provider: 'object', object: 'crm_asset' },
      columns: ['asset_number', 'name', 'crm_account', 'crm_product', 'warranty_end_date', 'last_service_date'],
      filter: [
        { field: 'is_under_warranty', operator: 'equals', value: false },
        { field: 'status', operator: 'not_equals', value: 'decommissioned' },
      ],
      sort: [{ field: 'warranty_end_date', order: 'desc' }],
    },

    /** Machines currently down */
    assets_in_repair: {
      name: 'assets_in_repair',
      type: 'grid',
      label: '🔧 Under Repair',
      data: { provider: 'object', object: 'crm_asset' },
      columns: ['asset_number', 'name', 'crm_account', 'crm_contact', 'site_address', 'last_service_date'],
      filter: [{ field: 'status', operator: 'equals', value: 'in_repair' }],
      sort: [{ field: 'last_service_date', order: 'asc' }],
    },

    my_assets: {
      name: 'my_assets',
      type: 'grid',
      label: 'My Assets',
      data: { provider: 'object', object: 'crm_asset' },
      columns: ['asset_number', 'name', 'crm_account', 'status', 'warranty_end_date', 'is_under_warranty'],
      filter: [{ field: 'owner', operator: 'equals', value: '{current_user_id}' }],
      sort: [{ field: 'warranty_end_date', order: 'asc' }],
    },
  },

  form: {
    type: 'tabbed',
    sections: [
      {
        label: 'Asset',
        columns: 2,
        fields: [
          'asset_number',
          { field: 'name', required: true, colSpan: 2 },
          { field: 'crm_account', required: true },
          'crm_product',
          'serial_number',
          { field: 'status', required: true },
        ],
      },
      {
        label: 'Installation',
        columns: 2,
        fields: [
          'install_date',
          'crm_contact',
          { field: 'site_address', colSpan: 2 },
          { field: 'site_location', colSpan: 2 },
        ],
      },
      {
        label: 'Warranty',
        columns: 2,
        fields: [
          'warranty_start_date',
          'warranty_end_date',
          'is_under_warranty',
          'crm_contract',
        ],
      },
      {
        label: 'Service',
        columns: 1,
        fields: ['last_service_date', 'owner', 'description'],
      },
    ],
  },
});
