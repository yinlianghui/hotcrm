---
title: Service Process & SLA Rules
description: Case priority, SLA breach handling, automatic escalation, satisfaction follow-up, and the field-service dispatch rules — the rules behind the Service desk and the engineers it sends out.
# sources: flows/objects this doc documents. Schedules/rules here are guarded by
# test/docs-drift.test.ts; build ignores unknown frontmatter keys.
sources:
  - flow:case_sla_monitor
  - flow:case_escalation
  - flow:case_csat_followup
  - flow:work_order_sla_monitor
  - flow:work_order_csat_followup
  - flow:asset_warranty_expiry
  - flow:create_work_order
  - flow:complete_work_order
  - object:crm_case
  - object:crm_knowledge_article
  - object:crm_asset
  - object:crm_work_order
---

# Service Process & SLA Rules

For service agents and service managers. Cases move from intake to resolution,
and the system enforces SLAs and escalations automatically — this guide explains
exactly when and how.

## Case priority

Every case carries a **priority** that drives its urgency:

`Low → Medium → High → Critical`

Each case also carries an **SLA Due Date** — the deadline to resolve it, set
when the case is logged per your support policy. The automation below watches
that clock and the priority for you.

## The clock is watched for you — SLA breach handling (automatic)

An **hourly** sweep checks every open case. If a case passes its **SLA Due Date**
without being resolved, the system automatically:

- marks it **SLA Violated**,
- **escalates** it (status → *Escalated*, with an escalation reason stamped), and
- alerts the owner.

You never have to manually catch a missed SLA — but you should work cases before
the due date, because a breach is recorded permanently on the case.

## Critical cases escalate instantly (automatic)

The moment a case is set to **Critical** priority, it escalates without waiting
for the SLA clock:

- status moves to **Escalated** with an escalation reason stamped (the case
  stays with its owner),
- an **urgent follow-up task** is created for the account owner (due the next
  day), and
- the case owner is notified.

> Two safety nets, two triggers: **priority = Critical** escalates *immediately*;
> a **missed SLA Due Date** escalates *on breach*. Both flag and alert; neither
> reassigns the case.

## After a case closes — satisfaction follow-up (automatic)

When a case is set to **Closed**, the system waits **one day** and then prompts
the case owner to collect a **satisfaction (CSAT) rating** from the customer.
This keeps CSAT capture consistent without anyone remembering to chase it.

## Knowledge articles

**Knowledge** articles are your searchable library of solutions — for agents to
reference while resolving a case and for customers to self-serve. Keeping
articles current and well-titled is the main lever for deflection and faster
resolution times. (Today a case isn't directly linked to an article; agents
search Knowledge by topic.)

## Field service — when the fix needs an engineer on site

A case is a **conversation**. Some repairs need a **visit**, and that is a
**Work Order**: one engineer, one site, one appointment.

### The equipment file (Assets)

Every unit you have installed at a customer site is an **Asset** — which
customer, which address, which model, its serial number, when it went in, and
**when its warranty ends**. Assets are what make "is this repair free?"
answerable without anyone looking it up in a spreadsheet.

If you record an install date and leave the warranty dates blank, the system
fills in a **12-month** factory warranty from the install date. Override either
date whenever the real coverage differs (extended contracts, negotiated terms).

### Raising a work order from a case

On any open case, **Create Work Order** carries the account, the contact and the
reported problem straight onto a new work order and links the two records. The
agent picks only the two things the case cannot know: the **work type** and the
**field priority**. The case then moves to *Waiting on Support* — it stays open
until the visit lands.

### Response promises by priority

Every work order gets a **Response Due** deadline the moment it is saved, from
its priority:

| Priority | Response promised within |
|---|---|
| Critical | **4 hours** |
| High | **8 hours** |
| Medium | **24 hours** (same day) |
| Low | **72 hours** |

Escalating a job to a higher priority **pulls its deadline in** from the moment
of the escalation. A deadline you enter by hand always wins — use it when you
have promised the customer a specific time.

The promise is that somebody **responds**, not that the repair is finished: the
clock stops the moment the work order leaves *New*.

### The clock is watched for you (automatic)

An **hourly** sweep checks every unfinished work order. Any job whose
**Response Due** has passed with nobody having responded is marked **Response
SLA Breached** and the **service supervisor** (the work order's owner) is
alerted. The sweep never changes the job's status — scheduling and dispatch stay
the dispatcher's call.

### Dispatch and the calendar

Assign a **Field Engineer** and a **Scheduled Start / End**, and the visit appears
on two boards:

- **Dispatch Calendar** — every scheduled visit, coloured by urgency.
- **Engineer Schedule** — one lane per engineer, so you can see who is free on a
  given day and how many calls each person already has.

If you schedule an engineer into a window that overlaps one of their other
visits, the work order is flagged **Schedule Conflict**. It is a warning, not a
block — dispatch sometimes stacks two jobs on one industrial park on purpose.

### Free or chargeable — decided before you dispatch

When a work order names an asset, the system reads that asset's warranty and
stamps the work order with:

- **Warranty Status** — *Under Warranty*, *Out of Warranty*, or *Unknown*, and
- **Billable Visit** — checked whenever the asset is out of warranty.

This happens **on save**, so the charge is visible on the record *before* anyone
is dispatched. A daily **01:00** sweep clears the warranty flag on assets whose
coverage has lapsed and notifies the asset owner, so the decision does not go
stale as time passes. Once a work order is closed or cancelled, its billing
decision is frozen — a warranty expiring later cannot rewrite the terms of a job
that already went out.

### Completing the visit

**Complete Visit** on the work order collects what the engineer did, the parts
used, the hours, and **who at the site accepted the work**. The work performed
and the accepting person's name are both **required** — a completion without
them is rejected. The customer's drawn signature is captured on the record's
**Completion** tab; completing without one records a warning rather than
blocking the engineer.

### The call-back

One day after a visit is **Completed**, the system prompts the supervisor to
call the site and log a **satisfaction rating** — the same loop cases already
use, on the visit instead of the ticket.

---

**Related:** who can see and edit which cases and work orders (escalation
sharing, the Field Engineer permission set), and how to change SLA timing,
escalation or warranty behavior, are covered in
**[Administration](crm_admin.md)**.
