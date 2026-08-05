---
"hotcrm": minor
---

Field service: installed assets, on-site work orders, dispatch and warranty-driven billing (REQ-0002)

HotCRM could resolve a support **ticket** but could not dispatch a **visit**. It
knew the product you sell (`crm_product`) and the agreement you signed
(`crm_contract`), but not the machine sitting on a customer's factory floor —
so "which unit is this, where is it, and is the repair still free?" had no
answer in the product. This release adds the missing middle.

**Two new objects**

- **`crm_asset` — the installed base.** Which customer, which site address and
  geo location, which model and serial, when it was installed, and when its
  warranty ends. Record an install date and leave the warranty dates blank and a
  12-month factory warranty is derived for you; a daily sweep clears the
  under-warranty flag when coverage lapses so the billing decision never goes
  stale.
- **`crm_work_order` — the on-site visit.** Account, contact, asset, originating
  case, priority, an eight-state lifecycle, the schedule, the assigned engineer,
  the completion log, the customer signature and the satisfaction rating.

**Response promises, watched automatically.** Every work order is stamped with a
response deadline from its priority — Critical 4h, High 8h, Medium 24h (same
day), Low 72h — and escalating a job pulls its deadline in. An hourly sweep
flags any unfinished work order whose deadline passed unanswered and alerts the
service supervisor.

**The charge is settled before dispatch.** When a work order names an asset, its
warranty is resolved on save into `warranty_status` and `is_billable`, so an
out-of-warranty visit is visibly chargeable *before* anyone is sent. The decision
freezes once the work order is closed.

**Dispatch on a calendar, not from memory.** A **Dispatch Calendar** of every
scheduled visit and an **Engineer Schedule** timeline with one lane per engineer,
plus awaiting-dispatch, response-at-risk and billable queues. Scheduling an
engineer into a window that overlaps one of their own visits raises a
double-booking flag (a warning, not a block).

**No re-keying between the desk and the field.** A `create_work_order` action on
`crm_case` carries the account, contact and reported problem onto a linked work
order and parks the case as *Waiting on Support*. A `complete_work_order` screen
collects the work performed, parts, hours and the accepting customer's name in
one form.

Also ships: a **Field Service** navigation group and dashboard, a
`field_engineer` permission set (org-wide read of the board, row-level write
scoped to the jobs assigned to them), asset and work-order analytics datasets,
demo seed data, all four locale bundles, and user documentation.

Deliberately **not** included, with the rationale recorded on
`docs/requirements/0002-field-service-work-orders.md`: automatic engineer
selection and route optimisation, multi-visit or multi-engineer jobs, parts
inventory consumption, and messaging-channel intake integrations (which belong
in a customer extension package, not the standard product).
