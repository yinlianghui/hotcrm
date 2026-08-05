# REQ-0002: Field service — installed-base repair, dispatch and on-site work orders

- **Status**: Shipped
- **Source**: After-sales service lead, mid-market equipment vendor
- **Raised**: 2026-07-28
- **Disposition**: B standard-enhancement (with C/D carve-outs — see below)
- **Traceability**: changeset `.changeset/field-service-work-orders.md` — `src/objects/{asset,work_order}.{object,hook}.ts`, `src/views/{asset,work_order}.view.ts`, `src/flows/{create-work-order,work-order-completion,work-order-sla-monitor,work-order-csat-followup,asset-warranty-expiry}.flow.ts`, `src/actions/work_order.actions.ts`, `src/profiles/field-engineer.profile.ts`, `src/datasets/{asset,work_order}.dataset.ts`, `src/dashboards/field-service.dashboard.ts`, `content/docs/service/field-service.mdx`. Tests: `test/hooks-runtime-field-service.test.ts`, `test/flow-field-service.test.ts`.

## Raw requirement (verbatim)

> 我们卖出去的设备都装在客户现场，出了问题客户打电话或者在微信群里报修，
> 现在全靠 Excel 和群里接龙转单，经常漏单。想要这么一套东西：
>
> 1. 每台卖出去的设备要有档案：装在哪个客户、哪个地址、什么型号、
>    什么时候装的、保修到什么时候。
> 2. 客户报修就开一张工单，挂在设备和客户名下。工单分紧急程度，
>    紧急的必须 4 小时内有人响应，普通的当天响应就行；超时要自动
>    提醒到服务主管。
> 3. 工单要派给现场工程师上门。谁哪天有空、一天跑几家，要能在日历上
>    排出来，别再靠脑子记。
> 4. 工程师上门干完活要登记做了什么，客户签字确认。
> 5. 保修期内免费；过保的上门要收费，派单前系统要提醒这单是收费单。
> 6. 修完了要像现在客服工单一样回访，让客户打个分。
>
> 我们客服部现在用系统里的客服工单（Case）接报修电话，希望这套东西
> 能接得上，别让客服再录一遍。

## Standard product analysis

HotCRM core today covers the **desk** half of service and none of the **field**
half:

| What core has | Where | What it does not cover |
| --- | --- | --- |
| `crm_case` — support ticket with `priority`, `sla_due_date`, `is_sla_violated`, `customer_rating`, `customer_signature` | `src/objects/case.object.ts` | A case is a *conversation*, not a *visit*. It has no schedule, no assigned field engineer, no work-performed log, no billability. |
| `case_sla_monitor` (hourly breach sweep), `case_csat_followup` (post-close rating prompt) | `src/flows/` | The mechanism the customer wants for work orders exists — but it is bound to `crm_case`. |
| `crm_product` — the sellable **catalogue** item | `src/objects/product.object.ts` | A catalogue SKU is a *model*, not a *machine*. There is nowhere to record "serial #4471, installed at Acme's Shanghai plant on 2024-03-11, warranty to 2026-03-11". |
| `crm_contract` — service agreements with `start_date`/`end_date` | `src/objects/contract.object.ts` | Contract-level coverage, not per-unit warranty. Nothing derives "is this specific machine still covered?" |
| Calendar / timeline / kanban list-view types | `src/views/*.view.ts` (`sla_calendar`, `task_calendar`, …) | The renderers the customer wants for dispatch already ship. Nothing binds them to an engineer's day. |

**The gap is a data model, not a renderer.** Every UI capability the customer
describes (calendar scheduling, signature capture, star rating, SLA sweeps,
notification to a supervisor) is already proven in this app on other objects.
What does not exist is the **installed base** (which machine, where, under
warranty until when) and the **work order** (who goes on site, when, what did
they do, is it billable).

## Disposition & rationale

**B — standard enhancement.** Field service is a *generic* CRM domain, not one
customer's shape. The burden of proof for entering core is met on three counts:

1. **The primitives are industry-standard**, not customer-specific: an installed
   asset with a serial number and a warranty window, and a work order with a
   schedule, an assigned engineer and a completion record. These are the same
   two objects every field-service product models (Salesforce Asset /
   WorkOrder, Dynamics Customer Asset / Work Order). Nothing in them encodes
   this customer's org chart, product line, or process vocabulary.
2. **Every install that sells a physical or installed product needs them.** The
   HotCRM demo account itself ("industrial automation") is exactly this shape.
   An install that sells pure software simply leaves the objects empty — the
   cost of carrying them is a nav group, not a constraint.
3. **It closes an existing core gap.** `crm_product` (catalogue) and
   `crm_contract` (agreement) both already point at a missing middle: the
   individual unit in the field. Cases resolve *tickets* but cannot dispatch a
   *visit*. Adding assets + work orders makes the objects already in core
   coherent, rather than bolting on a side system.

### What is deliberately NOT entering core

| Ask | Disposition | Why |
| --- | --- | --- |
| 微信群报修 — WeChat-group intake, group-chat handoff | **C — customer overlay** | A messaging-channel integration, not a CRM primitive. Core provides the landing surface (a work order carries an `origin` picklist, and Web-to-Case already exists); the WeChat bot, its group mapping and its message parsing belong in a customer extension package with its own `packageId` (framework ADR-0048). Baking one Chinese IM vendor into a marketplace app imposes it on every other install. |
| Skill-based auto-dispatch, route optimisation, travel-time-aware scheduling | **D — defer** | Needs a constraint solver, engineer skill/certification matrices and geodata this app does not model. **Revisit trigger:** two or more customers asking for automatic engineer selection (rather than manual dispatch on a calendar). v1 ships manual dispatch with a double-booking guard, which is what the customer actually described ("能在日历上排出来"). |
| Multi-visit jobs, multi-engineer crews, parts-inventory consumption | **D — defer** | Would require a `service_appointment` child object and stock movements against `crm_product`. v1 models **one visit per work order** and records parts as free text on the completion log. **Revisit trigger:** a customer whose jobs routinely span multiple days or engineers. |

### Ask-by-ask disposition

| # | Ask | Lands as |
| --- | --- | --- |
| 1 | Equipment file: customer, address, model, install date, warranty end | **B** — new `crm_asset` |
| 2 | Work order per repair, tied to asset + account; urgency tiers; 4h/same-day response SLA; supervisor alert on breach | **B** — new `crm_work_order` + `work_order_sla_monitor` flow (mirrors the proven `case_sla_monitor`) |
| 3 | Dispatch to a field engineer, visible on a calendar | **B** — schedule fields + dispatch calendar / engineer timeline views + a double-booking guard in the hook |
| 4 | On-site log of work performed + customer signature | **B** — completion fields + `Field.signature` (already used on `crm_case`) |
| 5 | Free under warranty, chargeable out of warranty, **flagged before dispatch** | **B** — warranty resolved from the asset onto the work order at save time, so the billable badge is on the record before anyone is dispatched |
| 6 | Post-repair CSAT call-back, same as cases | **A/B — reuse** — the `case_csat_followup` pattern, re-bound to work orders |
| — | Case hand-off so the support desk does not re-key the request | **B** — `create_work_order` screen-flow action on `crm_case`, copying account/contact/description/priority and linking both records |

## Product response

Standard metadata added under `src/`, shipped to **all** installs:

**Data** — `src/objects/`
- `asset.object.ts` / `asset.hook.ts` — `crm_asset`: account, site address + geo
  location, product/model, serial, install date, warranty window, service
  contract, status. The hook defaults a 12-month warranty from the install date
  and maintains `is_under_warranty`.
- `work_order.object.ts` / `work_order.hook.ts` — `crm_work_order`: account,
  contact, asset, originating case, type, priority (+ sortable `priority_rank`),
  status state machine, response SLA, schedule window, assigned engineer,
  completion log, signature, warranty/billing, CSAT. The hook stamps the
  response deadline from priority (critical 4h → medium same-day 24h), resolves
  warranty → billable from the asset, detects engineer double-booking, and
  stamps completion/signature dates.

**Automation** — `src/flows/`
- `work_order_sla_monitor` — hourly sweep; flags and escalates work orders that
  passed their response deadline unanswered and alerts the owner (service
  supervisor).
- `work_order_csat_followup` — waits a day after close, then prompts for the
  satisfaction rating.
- `asset_warranty_expiry` — daily sweep; flips `is_under_warranty` when coverage
  lapses and warns the account owner, so the billable flag stays true over time.
- `create_work_order` — screen flow behind the `create_work_order` action on
  `crm_case`.

**UI** — `src/views/`, `src/apps/crm.app.ts`, `src/dashboards/`
- Asset and work-order list views, a **dispatch calendar** and an
  **engineer timeline**, plus queue views (unassigned, at-risk, billable, mine).
- A Field Service nav group and a `field_service_dashboard` for the supervisor.

**Security / i18n / docs** — grants on `system_admin`, `service_agent` and a new
`field_engineer` permission set; all four locale bundles; user documentation
under `content/docs/` and the package doc `src/docs/crm_service.md`.

## Acceptance

1. `pnpm verify` green (validate, typecheck, lint, hygiene, build, test),
   including runtime tests for every new hook and flow.
2. In a seeded instance: an asset shows its warranty state; a work order raised
   against an out-of-warranty asset is flagged **billable before dispatch**; a
   critical work order gets a 4-hour response deadline and a medium one gets
   24 hours; scheduling two overlapping visits for the same engineer raises the
   conflict flag.
3. The dispatch calendar renders scheduled visits, and the Field Service
   dashboard renders its widgets in the Console.
4. From a case, `create_work_order` produces a linked work order carrying the
   account, contact and description without re-keying.
