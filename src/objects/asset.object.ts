import { F, P, cel } from '@objectstack/spec';
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * Asset (installed base) — REQ-0002.
 *
 * The missing middle between `crm_product` and `crm_contract`. A product is a
 * catalogue MODEL ("CNC-500"); a contract is a paper AGREEMENT. Neither can
 * answer the question every field-service call opens with: *which machine, at
 * which site, still under warranty until when?* This object is that unit of
 * installed equipment — the thing a work order is raised against.
 *
 * Warranty is modelled as a window (`warranty_start_date` … `warranty_end_date`)
 * plus a materialised `is_under_warranty` flag. The flag exists because warranty
 * state has to be FILTERABLE (billable queues, at-risk lists) and a formula
 * field cannot be used as a query predicate in this app (ADR-0072; pinned by
 * `test/metadata-references.test.ts`). It is maintained from two directions:
 * `asset.hook.ts` on every write, and the daily `asset_warranty_expiry` sweep
 * for the case where nothing writes and the clock simply runs out.
 */
export const Asset = ObjectSchema.create({
  name: 'crm_asset',
  label: 'Asset',
  pluralLabel: 'Assets',
  icon: 'hard-drive',
  description: 'Installed equipment at a customer site — the unit a work order is raised against',

  // ADR-0090 D1/D7: OWD is an authored decision. The installed base is shared
  // REFERENCE data, exactly like the product catalogue: a dispatcher, an agent
  // on the phone and an engineer on site all have to look up the same machine,
  // and none of them owns it. Reads are org-wide; only the owner (the account /
  // service team) and admins edit.
  sharingModel: 'public_read',

  // ADR-0079: `nameField` names a real field, so the "AST-00001 - <name>"
  // record title is reproduced by a formula field.
  nameField: 'display_title',
  // Explicit search targets (ADR-0061). REQUIRED because `nameField` is a
  // FORMULA: without this, $search defaults to a field that is not a real
  // column and the lookup picker + global search silently return zero.
  // `serial_number` is first-class here — it is what a customer reads out over
  // the phone.
  searchableFields: ['name', 'serial_number', 'asset_number'],
  highlightFields: ['asset_number', 'name', 'crm_account', 'status', 'warranty_end_date'],

  fieldGroups: [
    { key: 'basic',    label: 'Asset Information', icon: 'info' },
    { key: 'install',  label: 'Installation Site', icon: 'map-pin' },
    { key: 'warranty', label: 'Warranty & Coverage', icon: 'shield-check' },
    { key: 'service',  label: 'Service History',   icon: 'wrench' },
    { key: 'system',   label: 'System',            icon: 'database', defaultExpanded: false },
  ],

  fields: {
    asset_number: Field.autonumber({
      label: 'Asset Number',
      group: 'basic',
      format: 'AST-{00000}',
    }),

    name: Field.text({
      label: 'Asset Name',
      group: 'basic',
      required: true,
      searchable: true,
      maxLength: 255,
      description: 'How the site refers to this unit, e.g. "Line 2 press"',
    }),

    display_title: Field.formula({
      label: 'Display Title',
      group: 'basic',
      expression: F`record.asset_number + " - " + record.name`,
    }),

    // ─── Who owns it, and what model is it ────────────────────────────
    crm_account: Field.lookup('crm_account', {
      label: 'Account',
      group: 'basic',
      required: true,
    }),

    crm_contact: Field.lookup('crm_contact', {
      label: 'Site Contact',
      group: 'install',
      // Cascading lookup (ADR-0049): only contacts of this asset's account.
      dependsOn: ['crm_account'],
      description: 'Who to call at the site before an engineer arrives',
    }),

    // The model. Deliberately a lookup to the existing catalogue rather than a
    // free-text "model" string — it is what makes "how many CNC-500s are in the
    // field, and how many are out of warranty" answerable.
    crm_product: Field.lookup('crm_product', {
      label: 'Product / Model',
      group: 'basic',
    }),

    serial_number: Field.text({
      label: 'Serial Number',
      group: 'basic',
      searchable: true,
      maxLength: 100,
    }),

    status: Field.select({
      label: 'Status',
      group: 'basic',
      required: true,
      trackHistory: true,
      options: [
        { label: 'Installed', value: 'installed', color: '#00AA00', default: true },
        { label: 'Under Repair', value: 'in_repair', color: '#FFA500' },
        { label: 'Suspended', value: 'suspended', color: '#FFD700' },
        { label: 'Decommissioned', value: 'decommissioned', color: '#666666' },
      ],
    }),

    // ─── Where it physically is ───────────────────────────────────────
    install_date: Field.date({
      label: 'Install Date',
      group: 'install',
    }),

    site_address: Field.address({
      label: 'Site Address',
      group: 'install',
      description: 'Where the engineer actually drives to',
    }),

    site_location: Field.location({
      label: 'Site Location',
      group: 'install',
      description: 'Geo coordinates for map views and route planning',
    }),

    // ─── Coverage ─────────────────────────────────────────────────────
    warranty_start_date: Field.date({
      label: 'Warranty Start',
      group: 'warranty',
    }),

    warranty_end_date: Field.date({
      label: 'Warranty End',
      group: 'warranty',
      description: 'Visits after this date are chargeable',
    }),

    // NOT `readonly`: this is written by BOTH `asset_warranty_defaults` (hook)
    // and the `asset_warranty_expiry` flow, and 16.x silently DROPS writes to
    // readonly fields from a flow's `update_record` node (#2948) — readonly
    // here would disable warranty expiry without any error, exactly as it did
    // for `crm_case.is_sla_violated`.
    is_under_warranty: Field.boolean({
      label: 'Under Warranty',
      group: 'warranty',
      defaultValue: true,
    }),

    crm_contract: Field.lookup('crm_contract', {
      label: 'Service Contract',
      group: 'warranty',
      dependsOn: ['crm_account'],
      description: 'Extended coverage beyond the factory warranty',
    }),

    // ─── Service history ──────────────────────────────────────────────
    // Stamped by `work_order_side_effects` when a visit completes. NOT
    // readonly, for the same #2948 reason as above.
    last_service_date: Field.date({
      label: 'Last Service Date',
      group: 'service',
    }),

    owner: Field.lookup('sys_user', {
      defaultValue: cel`os.user.id`,
      label: 'Asset Owner',
      group: 'system',
      trackHistory: true,
    }),

    description: Field.markdown({
      label: 'Notes',
      group: 'system',
    }),
  },

  // `asset_number` is an autonumber and the platform's autonumber sequence is
  // PER TENANT — every organization counts from 1. A platform-wide unique index
  // would therefore reject the second organization's `AST-00001` on insert
  // (framework #3696), so the constraint is spelled as the tenant composite
  // that matches the sequence feeding it.
  indexes: [
    { fields: ['organization_id', 'asset_number'], unique: true },
    { fields: ['crm_account'] },
    { fields: ['crm_product'] },
    { fields: ['serial_number'] },
    { fields: ['status'] },
    { fields: ['warranty_end_date'] },
  ],

  enable: {
    apiEnabled: true,
    apiMethods: ['get', 'list', 'create', 'update', 'delete'],
  },

  // ADR-0052 §5b.2 — declarative timeline entries. The hook keeps its own
  // side-effects; these are narrative only.
  activityMilestones: [
    { field: 'status', value: 'in_repair', summary: 'Asset under repair — {name}', type: 'updated' },
    { field: 'status', value: 'decommissioned', summary: 'Asset decommissioned — {name}', type: 'completed' },
  ],

  validations: [
    {
      name: 'warranty_end_after_start',
      type: 'script',
      severity: 'error',
      message: 'Warranty End must be on or after Warranty Start',
      condition: P`has(record.warranty_end_date) && record.warranty_end_date != null && has(record.warranty_start_date) && record.warranty_start_date != null && record.warranty_end_date < record.warranty_start_date`,
    },
    {
      name: 'installed_asset_has_install_date',
      type: 'script',
      severity: 'warning',
      message: 'An installed asset should record when it was installed',
      condition: P`has(record.status) && record.status == "installed" && (!has(record.install_date) || record.install_date == null)`,
    },
  ],
});
