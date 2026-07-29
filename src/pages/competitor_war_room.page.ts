// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { definePage } from '@objectstack/spec/ui';

/**
 * Competitor War Room — kind:'react' source page (ADR-0081).
 *
 * The battlecard catalog (`crm_competitor`) rendered as a command center
 * instead of a flat list: competitors ranked by live threat (threat_level
 * weighted by open pipeline they contest), one click opens the full
 * battlecard — our advantages vs. theirs side by side, contested deals,
 * win/loss record — and stale intel is editable in place (threat level,
 * both battlecard columns, notes) without leaving the room.
 *
 * Why a react page and not views: the room needs cross-object aggregation
 * (opportunities.crm_competitors → per-competitor pipeline stats) plus
 * in-place editing of markdown intel, which no list/form view composes.
 *
 * Data notes:
 *  - `crm_competitors` on opportunity is a multi-value lookup; values are
 *    record ids after seed-heal (#3911), but we match by id OR name
 *    defensively.
 *  - adapter result shapes vary by runtime version — read
 *    `res.data ?? res.records ?? res`.
 *
 * Styling is a deliberate fixed dark "ops room" palette (independent of
 * console theme) — the point of the page is the war-room look.
 */
export const CompetitorWarRoomPage = definePage({
  name: 'competitor_war_room',
  label: 'Competitor War Room',
  description:
    'Threat-ranked competitive command center: battlecards, contested pipeline, in-place intel editing.',
  type: 'home',
  kind: 'react',
  source: `
function Page() {
  const adapter = useAdapter();
  const [competitors, setCompetitors] = React.useState(null);
  const [opps, setOpps] = React.useState([]);
  const [accounts, setAccounts] = React.useState([]);
  const [selId, setSelId] = React.useState(null);
  const [draft, setDraft] = React.useState(null); // non-null => editing
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [savedFlash, setSavedFlash] = React.useState(false);

  const rows = (res) => {
    if (!res) return [];
    if (Array.isArray(res)) return res;
    return res.data ?? res.records ?? [];
  };

  React.useEffect(() => {
    let alive = true;
    Promise.all([
      adapter.find('crm_competitor', {}),
      adapter.find('crm_opportunity', {}),
      adapter.find('crm_account', {}),
    ]).then(([c, o, a]) => {
      if (!alive) return;
      setCompetitors(rows(c));
      setOpps(rows(o));
      setAccounts(rows(a));
    }).catch((e) => { if (alive) { setError(String(e && e.message || e)); setCompetitors([]); } });
    return () => { alive = false; };
  }, []);

  // ── palette ──────────────────────────────────────────────────────────
  const C = {
    bg: '#0a0f1c', panel: '#111a2e', panelHi: '#16223c', line: '#233350',
    text: '#e6edf7', dim: '#8ca3c7', faint: '#5a708f',
    red: '#ff4d5e', amber: '#ffb02e', green: '#3ddc84', blue: '#4d9fff',
  };
  const THREAT = {
    high:   { label: '高威胁', color: C.red,   base: 70 },
    medium: { label: '中威胁', color: C.amber, base: 45 },
    low:    { label: '低威胁', color: C.green, base: 20 },
  };
  const STAGE = {
    prospecting: { label: '潜在', color: '#808080' },
    qualification: { label: '验证', color: '#FFA500' },
    needs_analysis: { label: '需求分析', color: '#FFD700' },
    proposal: { label: '方案', color: '#4d9fff' },
    negotiation: { label: '谈判', color: '#9370DB' },
    closed_won: { label: '赢单', color: '#3ddc84' },
    closed_lost: { label: '输单', color: '#ff4d5e' },
  };

  const fmtMoney = (n) => {
    const v = Number(n) || 0;
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1).replace(/\\.0$/, '') + 'M';
    if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
    return '$' + v;
  };

  // ── per-competitor battle stats ──────────────────────────────────────
  const accName = React.useMemo(() => {
    const m = {};
    for (const a of accounts) { m[a.id] = a.name; }
    return m;
  }, [accounts]);

  const stats = React.useMemo(() => {
    const list = competitors || [];
    const byKey = {};
    for (const c of list) {
      byKey[c.id] = c.id; byKey[c.name] = c.id;
    }
    const m = {};
    for (const c of list) m[c.id] = { open: [], openAmount: 0, won: 0, lost: 0, deals: [] };
    for (const o of opps) {
      const refs = Array.isArray(o.crm_competitors) ? o.crm_competitors : [];
      for (const ref of refs) {
        const key = ref && typeof ref === 'object' ? (ref.id ?? ref.value) : ref;
        const cid = byKey[key];
        if (!cid) continue;
        const s = m[cid];
        s.deals.push(o);
        if (o.stage === 'closed_won') s.won += 1;
        else if (o.stage === 'closed_lost') s.lost += 1;
        else { s.open.push(o); s.openAmount += Number(o.amount) || 0; }
      }
    }
    return m;
  }, [competitors, opps]);

  const ranked = React.useMemo(() => {
    const list = (competitors || []).filter((c) => c.is_active !== false);
    const maxOpen = Math.max(1, ...list.map((c) => (stats[c.id] ? stats[c.id].openAmount : 0)));
    const scored = list.map((c) => {
      const s = stats[c.id] || { openAmount: 0 };
      const t = THREAT[c.threat_level] || THREAT.low;
      return { c, score: Math.min(100, Math.round(t.base + 30 * (s.openAmount / maxOpen))) };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }, [competitors, stats]);

  React.useEffect(() => {
    if (!selId && ranked.length) setSelId(ranked[0].c.id);
  }, [ranked, selId]);

  const sel = (competitors || []).find((c) => c.id === selId) || null;
  const selStats = (sel && stats[sel.id]) || { open: [], openAmount: 0, won: 0, lost: 0, deals: [] };
  const selScore = (ranked.find((r) => r.c.id === selId) || { score: 0 }).score;

  const totals = React.useMemo(() => {
    const list = (competitors || []).filter((c) => c.is_active !== false);
    const high = list.filter((c) => c.threat_level === 'high').length;
    const contested = {};
    let amount = 0;
    for (const c of list) {
      const s = stats[c.id]; if (!s) continue;
      for (const o of s.open) { if (!contested[o.id]) { contested[o.id] = 1; amount += Number(o.amount) || 0; } }
    }
    return { count: list.length, high, contestedDeals: Object.keys(contested).length, amount };
  }, [competitors, stats]);

  // ── editing ──────────────────────────────────────────────────────────
  const startEdit = () => sel && setDraft({
    threat_level: sel.threat_level,
    main_products: sel.main_products || '',
    our_advantages: sel.our_advantages || '',
    our_disadvantages: sel.our_disadvantages || '',
    notes: sel.notes || '',
  });
  const saveEdit = () => {
    if (!sel || !draft) return;
    setSaving(true); setError(null);
    adapter.update('crm_competitor', sel.id, draft).then(() => {
      setCompetitors((prev) => prev.map((c) => (c.id === sel.id ? { ...c, ...draft } : c)));
      setDraft(null); setSaving(false);
      setSavedFlash(true); setTimeout(() => setSavedFlash(false), 2000);
    }).catch((e) => { setSaving(false); setError('保存失败：' + String(e && e.message || e)); });
  };

  // ── markdown-lite (bullets + **bold**) ───────────────────────────────
  const bold = (line, color) => {
    const parts = String(line).split('**');
    return parts.map((p, i) => i % 2
      ? React.createElement('strong', { key: i, style: { color, fontWeight: 700 } }, p)
      : p);
  };
  const md = (text, accent) => {
    const lines = String(text || '').split('\\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return React.createElement('div', { style: { color: C.faint, fontStyle: 'italic' } }, '暂无情报 — 点击「更新情报」补充');
    return lines.map((l, i) => {
      const isBullet = l.startsWith('- ') || l.startsWith('* ');
      const body = isBullet ? l.slice(2) : l;
      return React.createElement('div', { key: i, style: { display: 'flex', gap: 8, padding: '5px 0', lineHeight: 1.6 } },
        isBullet ? React.createElement('span', { style: { color: accent, flexShrink: 0, fontWeight: 700 } }, '▸') : null,
        React.createElement('span', { style: { color: C.text } }, bold(body, accent)));
    });
  };

  // ── shared style atoms ───────────────────────────────────────────────
  const mono = { fontFamily: '"SF Mono", ui-monospace, Menlo, Consolas, monospace' };
  const tag = (bg, fg) => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: bg, color: fg, letterSpacing: '0.05em' });
  const panel = { background: C.panel, border: '1px solid ' + C.line, borderRadius: 12 };
  const label = { ...mono, fontSize: 11, letterSpacing: '0.18em', color: C.faint, textTransform: 'uppercase' };
  const inputStyle = { width: '100%', boxSizing: 'border-box', background: '#0d1526', color: C.text, border: '1px solid ' + C.line, borderRadius: 8, padding: '10px 12px', fontSize: 13, lineHeight: 1.6, fontFamily: 'inherit', resize: 'vertical' };
  const btn = (primary) => ({ padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid ' + (primary ? C.blue : C.line), background: primary ? C.blue : 'transparent', color: primary ? '#fff' : C.dim });

  const threatOf = (c) => THREAT[c.threat_level] || THREAT.low;

  // ── loading ──────────────────────────────────────────────────────────
  if (competitors === null) {
    return React.createElement('div', { style: { minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.dim, ...mono } }, 'ESTABLISHING SITUATION ROOM…');
  }

  const statTile = (title, value, accent) =>
    React.createElement('div', { style: { ...panel, padding: '14px 20px', flex: 1, minWidth: 150 } },
      React.createElement('div', { style: label }, title),
      React.createElement('div', { style: { ...mono, fontSize: 28, fontWeight: 800, color: accent || C.text, marginTop: 6 } }, value));

  return React.createElement('div', { style: { minHeight: '100vh', background: 'radial-gradient(1200px 500px at 70% -10%, #16223c 0%, ' + C.bg + ' 55%)', padding: '28px 32px 48px', color: C.text } },

    // header
    React.createElement('div', { style: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 20 } },
      React.createElement('div', null,
        React.createElement('div', { style: { ...label, color: C.red } }, '⬤ LIVE · COMPETITIVE INTELLIGENCE'),
        React.createElement('h1', { style: { margin: '6px 0 4px', fontSize: 34, fontWeight: 900, letterSpacing: '0.02em' } }, '竞对作战室'),
        React.createElement('div', { style: { color: C.dim, fontSize: 13 } }, '威胁实时排序 · 点击竞对查看作战卡 · 情报过时当场更新')),
      React.createElement('div', { style: { display: 'flex', gap: 12, flexWrap: 'wrap' } },
        statTile('监控竞对', totals.count),
        statTile('高威胁', totals.high, C.red),
        statTile('交火中商机', totals.contestedDeals, C.amber),
        statTile('争夺金额', fmtMoney(totals.amount), C.blue))),

    error ? React.createElement('div', { style: { ...panel, borderColor: C.red, color: C.red, padding: '10px 16px', marginBottom: 16, fontSize: 13 } }, error) : null,

    // main grid
    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(300px, 360px) 1fr', gap: 20, alignItems: 'start' } },

      // ── threat board (left) ──
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        React.createElement('div', { style: { ...label, padding: '0 4px 2px' } }, 'THREAT BOARD · 按威胁排序'),
        ranked.map(({ c, score }) => {
          const t = threatOf(c);
          const s = stats[c.id] || { open: [], openAmount: 0, won: 0, lost: 0 };
          const active = c.id === selId;
          return React.createElement('div', {
            key: c.id,
            onClick: () => { setSelId(c.id); setDraft(null); setError(null); },
            style: { ...panel, padding: '14px 16px', cursor: 'pointer',
              background: active ? C.panelHi : C.panel,
              borderColor: active ? t.color : C.line,
              boxShadow: active ? '0 0 0 1px ' + t.color + ', 0 8px 24px rgba(0,0,0,0.35)' : 'none' } },
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 } },
              React.createElement('div', { style: { fontSize: 16, fontWeight: 800 } }, c.name),
              React.createElement('span', { style: tag(t.color + '22', t.color) }, t.label)),
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 8px' } },
              React.createElement('div', { style: { flex: 1, height: 6, borderRadius: 3, background: '#0d1526', overflow: 'hidden' } },
                React.createElement('div', { style: { width: score + '%', height: '100%', borderRadius: 3, background: 'linear-gradient(90deg, ' + t.color + '88, ' + t.color + ')' } })),
              React.createElement('span', { style: { ...mono, fontSize: 12, fontWeight: 800, color: t.color, minWidth: 30, textAlign: 'right' } }, score)),
            React.createElement('div', { style: { ...mono, display: 'flex', gap: 14, fontSize: 12, color: C.dim } },
              React.createElement('span', null, '交火 ', React.createElement('b', { style: { color: C.text } }, s.open.length), ' 单'),
              React.createElement('span', null, '在途 ', React.createElement('b', { style: { color: C.text } }, fmtMoney(s.openAmount))),
              React.createElement('span', null, '战绩 ', React.createElement('b', { style: { color: C.green } }, s.won), React.createElement('span', { style: { color: C.faint } }, ' 胜 '), React.createElement('b', { style: { color: C.red } }, s.lost), React.createElement('span', { style: { color: C.faint } }, ' 负'))));
        })),

      // ── battlecard (right) ──
      !sel
        ? React.createElement('div', { style: { ...panel, padding: 60, textAlign: 'center', color: C.faint } }, '选择左侧竞对查看作战卡')
        : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },

            // card header
            React.createElement('div', { style: { ...panel, padding: '20px 24px' } },
              React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' } },
                React.createElement('div', null,
                  React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' } },
                    React.createElement('h2', { style: { margin: 0, fontSize: 26, fontWeight: 900 } }, sel.name),
                    draft
                      ? React.createElement('select', {
                          value: draft.threat_level,
                          onChange: (e) => setDraft({ ...draft, threat_level: e.target.value }),
                          style: { ...inputStyle, width: 'auto', padding: '4px 8px', fontSize: 12 } },
                          React.createElement('option', { value: 'high' }, '高威胁'),
                          React.createElement('option', { value: 'medium' }, '中威胁'),
                          React.createElement('option', { value: 'low' }, '低威胁'))
                      : React.createElement('span', { style: tag(threatOf(sel).color + '22', threatOf(sel).color) }, '威胁指数 ' + selScore + ' · ' + threatOf(sel).label),
                    savedFlash ? React.createElement('span', { style: { ...tag(C.green + '22', C.green) } }, '✓ 情报已更新') : null),
                  sel.website ? React.createElement('a', { href: sel.website, target: '_blank', rel: 'noreferrer', style: { color: C.blue, fontSize: 13, textDecoration: 'none' } }, sel.website) : null),
                React.createElement('div', { style: { display: 'flex', gap: 8 } },
                  draft
                    ? [React.createElement('button', { key: 's', onClick: saveEdit, disabled: saving, style: { ...btn(true), opacity: saving ? 0.6 : 1 } }, saving ? '保存中…' : '保存情报'),
                       React.createElement('button', { key: 'c', onClick: () => setDraft(null), disabled: saving, style: btn(false) }, '取消')]
                    : React.createElement('button', { onClick: startEdit, style: btn(false) }, '✎ 更新情报'))),
              React.createElement('div', { style: { marginTop: 14 } },
                React.createElement('div', { style: label }, '主打产品'),
                draft
                  ? React.createElement('textarea', { rows: 2, value: draft.main_products, onChange: (e) => setDraft({ ...draft, main_products: e.target.value }), style: { ...inputStyle, marginTop: 6 } })
                  : React.createElement('div', { style: { marginTop: 6, color: C.text, fontSize: 14, lineHeight: 1.6 } }, sel.main_products || '—'))),

            // advantage / disadvantage duel
            React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 } },
              React.createElement('div', { style: { ...panel, borderTop: '3px solid ' + C.green, padding: '16px 20px' } },
                React.createElement('div', { style: { ...label, color: C.green, marginBottom: 10 } }, '⚔ 我们打它 · OUR EDGE'),
                draft
                  ? React.createElement('textarea', { rows: 8, value: draft.our_advantages, onChange: (e) => setDraft({ ...draft, our_advantages: e.target.value }), style: inputStyle })
                  : React.createElement('div', { style: { fontSize: 13.5 } }, md(sel.our_advantages, C.green))),
              React.createElement('div', { style: { ...panel, borderTop: '3px solid ' + C.red, padding: '16px 20px' } },
                React.createElement('div', { style: { ...label, color: C.red, marginBottom: 10 } }, '⚠ 它打我们 · THEIR EDGE'),
                draft
                  ? React.createElement('textarea', { rows: 8, value: draft.our_disadvantages, onChange: (e) => setDraft({ ...draft, our_disadvantages: e.target.value }), style: inputStyle })
                  : React.createElement('div', { style: { fontSize: 13.5 } }, md(sel.our_disadvantages, C.red)))),

            // field notes
            React.createElement('div', { style: { ...panel, padding: '16px 20px' } },
              React.createElement('div', { style: { ...label, marginBottom: 10 } }, '前线情报 · FIELD NOTES'),
              draft
                ? React.createElement('textarea', { rows: 3, value: draft.notes, onChange: (e) => setDraft({ ...draft, notes: e.target.value }), style: inputStyle })
                : React.createElement('div', { style: { fontSize: 13.5 } }, md(sel.notes, C.amber))),

            // contested deals
            React.createElement('div', { style: { ...panel, padding: '16px 20px' } },
              React.createElement('div', { style: { ...label, marginBottom: 12 } }, '交火商机 · CONTESTED DEALS (' + selStats.deals.length + ')'),
              selStats.deals.length === 0
                ? React.createElement('div', { style: { color: C.faint, fontStyle: 'italic', fontSize: 13 } }, '暂无与该竞对交火的商机')
                : selStats.deals
                    .slice()
                    .sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0))
                    .map((o) => {
                      const st = STAGE[o.stage] || { label: o.stage, color: C.dim };
                      return React.createElement('div', { key: o.id, style: { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid ' + C.line } },
                        React.createElement('span', { style: { width: 8, height: 8, borderRadius: 4, background: st.color, flexShrink: 0 } }),
                        React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                          React.createElement('div', { style: { fontWeight: 700, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, o.name),
                          React.createElement('div', { style: { color: C.faint, fontSize: 12 } }, accName[o.crm_account] || '')),
                        React.createElement('span', { style: { ...tag(st.color + '22', st.color), flexShrink: 0 } }, st.label),
                        React.createElement('span', { style: { ...mono, fontWeight: 800, fontSize: 14, minWidth: 70, textAlign: 'right', flexShrink: 0 } }, fmtMoney(o.amount)),
                        React.createElement('span', { style: { ...mono, color: C.dim, fontSize: 12, minWidth: 42, textAlign: 'right', flexShrink: 0 } }, (o.probability != null ? o.probability : '–') + '%'));
                    })))));
}
`,
});
