/* Ahal365 — uygulama */
(function () {
  'use strict';
  const D = window.AHAL_DATA || { leagues: [], teams: {}, tables: {}, matches: [], results: [], updated: null };
  const BB = D.bb || { teams: {}, matches: [], results: [], table: [] };
  const TZ = 'Asia/Ashgabat', CUR = 'TMT';
  const MIN_STAKE = 20, MAX_STAKE = 5000, MAX_SEL = 20, MAX_WIN = 500000, START_BAL = 1000, TIP_N = 10;
  const GROUPS = ['tr', 'ru', 'eu', 'nat', 'en', 'es', 'de', 'it', 'fr', 'nl', 'ot'];
  const GBADGE = { tr: 'TR', ru: 'RU', eu: 'UEFA', nat: 'INT', en: 'ENG', es: 'ESP', de: 'GER', it: 'ITA', fr: 'FRA', nl: 'NED', ot: 'EUR' };

  const LS = {
    get(k, d) { try { const v = localStorage.getItem('ahal_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('ahal_' + k, JSON.stringify(v)); } catch (e) { /* ozel mod */ } }
  };

  // ---------- durum ----------
  let lang = LS.get('lang', 'tr');
  if (!I18N[lang]) lang = 'tr';
  let slip = LS.get('slip', []);          // [{m, k}]
  let stake = LS.get('stake', MIN_STAKE);
  let users = LS.get('users', {});
  let user = LS.get('user', null);
  if (user && !users[user]) user = null;
  let coupons = [], balance = 0, authErr = { login: '', reg: '' };
  const ukey = k => k + '_' + user;
  function loadUser() { coupons = user ? LS.get(ukey('coupons'), []) : []; balance = user ? LS.get(ukey('balance'), START_BAL) : 0; }
  const saveUser = () => { if (user) { LS.set(ukey('coupons'), coupons); LS.set(ukey('balance'), balance); } };
  loadUser();
  const flt = { lg: 'all', day: null, q: '', alim: 48, lvall: false };
  let dtab = 'pred', ttab = 'all', slipErr = '', navDepth = 0;

  const $ = id => document.getElementById(id);
  const t = k => (I18N[lang][k] !== undefined ? I18N[lang][k] : (I18N.tr[k] !== undefined ? I18N.tr[k] : k));
  const fmt = (s, o) => s.replace(/\{(\w+)\}/g, (_, k) => o[k]);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = p => Math.round(p * 100);
  const money = n => n.toLocaleString(lang === 'tr' ? 'tr-TR' : 'ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + CUR;

  // ---------- veri yardimcilari ----------
  Object.assign(D.teams, BB.teams);
  const MATCH = {}; D.matches.concat(BB.matches).forEach(m => { MATCH[m.id] = m; if (!m.pl) m.pl = { h: [], a: [] }; if (!m.sq) m.sq = { h: null, a: null }; });
  const LG = {}; D.leagues.forEach(l => { LG[l.id] = l; });
  const RES = {}; D.results.concat(BB.results).forEach(r => { RES[r.id] = r; });
  const team = id => D.teams[id] || { n: '?', s: '?', l: '' };
  const tn = id => { const x = team(id); return x[lang] || x.n; };      // tam ad (dile gore)
  const ts = id => { const x = team(id); return x[lang] || x.s || x.n; }; // kisa ad
  const ln = id => { const l = LG[id]; return l ? (typeof l.n === 'string' ? l.n : (l.n[lang] || l.n.tr)) : (id === 'nba' ? 'NBA' : ''); };
  const future = m => new Date(m.d).getTime() > Date.now();
  const upcoming = () => D.matches.filter(future);
  const byDate = (a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0);

  const dayKey = d => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
  const timeOf = d => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d));
  const keyParts = key => { const [y, m, d] = key.split('-').map(Number); return { d, m, wd: new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() }; };
  function relDay(key) {
    if (key === dayKey(Date.now())) return t('today');
    if (key === dayKey(Date.now() + 864e5)) return t('tomorrow');
    return '';
  }
  function dayLabel(key) {   // "Bugün · 14 Kasım Cumartesi"
    const p = keyParts(key), rel = relDay(key);
    return (rel ? rel + ' · ' : '') + p.d + ' ' + t('mo_l')[p.m - 1] + ' ' + t('wd_l')[p.wd];
  }
  const dayShort = key => { const p = keyParts(key); return p.d + ' ' + t('mo')[p.m - 1]; };
  const shortDate = d => { const k = dayKey(d).split('-'); return k[2] + '.' + k[1]; };

  function logo(id, cls) {
    const tm = team(id), ini = esc((tm.s || tm.n).replace(/[^A-Za-zÀ-ÿА-я]/g, '').slice(0, 2).toUpperCase());
    const c = 'logo' + (cls ? ' ' + cls : '');
    return tm.l
      ? `<img class="${c}" src="${esc(tm.l)}" alt="" loading="${cls === 'sm' ? 'eager' : 'lazy'}" decoding="async" onerror="this.outerHTML='<span class=&quot;${c} ph&quot;>${ini}</span>'">`
      : `<span class="${c} ph">${ini}</span>`;
  }
  const pair = (h, a, hn, an) => `<span class="pair" title="${esc(hn)} – ${esc(an)}"><span class="ts">${logo(h, 'sm')}<span class="nm">${esc(hn)}</span></span><span class="sep">–</span><span class="ts">${logo(a, 'sm')}<span class="nm">${esc(an)}</span></span></span>`;
  const badge = lg => `<span class="cc">${GBADGE[(LG[lg] || {}).g] || 'NBA'}</span>`;
  const srcName = s => (s === 'model' ? 'Ahal365' : s);
  const srcBadge = s => `<span class="srcb ${s === 'model' ? 'm' : ''}">${esc(srcName(s))}</span>`;

  function mkLabel(k, m, line) {
    const l = line != null ? line : (m || {}).line;
    if (k === 'BO' || k === 'BU') return t('bb_total') + ': ' + (k === 'BO' ? t('over') : t('under')) + ' ' + l;
    if (/^[OU]/.test(k)) return (k[0] === 'O' ? t('over') : t('under')) + ' ' + k.slice(1);
    if (k === 'KGV') return t('btts') + ': ' + t('yes');
    if (k === 'KGY') return t('btts') + ': ' + t('no');
    return (/^(1|X|2)$/.test(k) ? t('ms') : t('dc')) + ': ' + k;
  }
  function mkShort(k, m) {
    if (k === 'BO' || k === 'BU') return (k === 'BO' ? t('over') : t('under')) + ' ' + m.line;
    if (/^[OU]/.test(k)) return (k[0] === 'O' ? t('over') : t('under')) + ' ' + k.slice(1);
    if (k === 'KGV') return t('yes');
    if (k === 'KGY') return t('no');
    return k;
  }
  function wins(k, hs, as, line) {
    const tot = hs + as;
    switch (k) {
      case '1': return hs > as; case 'X': return hs === as; case '2': return hs < as;
      case '1X': return hs >= as; case '12': return hs !== as; case 'X2': return hs <= as;
      case 'KGV': return hs > 0 && as > 0; case 'KGY': return !(hs > 0 && as > 0);
      case 'BO': return tot > line; case 'BU': return tot < line;
    }
    const n = parseFloat(k.slice(1));
    return k[0] === 'O' ? tot > n : tot < n;
  }
  function probOf(m, k) {
    const p = m.p;
    switch (k) {
      case '1': return p.p1; case 'X': return p.px; case '2': return p.p2;
      case '1X': return p.p1 + p.px; case '12': return p.p1 + p.p2; case 'X2': return p.px + p.p2;
      case 'O1.5': return p.o15; case 'U1.5': return 1 - p.o15; case 'O2.5': return p.o25; case 'U2.5': return 1 - p.o25;
      case 'O3.5': return p.o35; case 'U3.5': return 1 - p.o35; case 'KGV': return p.btts; case 'KGY': return 1 - p.btts;
    }
    return 0;
  }
  function tipOf(m) {
    if (m._tip) return m._tip;
    const ks = ['1', 'X', '2', '1X', 'X2', 'O2.5', 'U2.5', 'KGV', 'KGY'];
    let c = ks.map(k => ({ k, p: probOf(m, k), o: m.o[k] })).filter(x => x.o);
    const fit = c.filter(x => wins(x.k, m.p.score[0], m.p.score[1]));   // oneri, tahmini skorla celismemeli
    if (fit.length) c = fit;
    const good = c.filter(x => x.o >= 1.3);
    if (good.length) c = good;
    c.sort((a, b) => b.p - a.p);
    const best = c[0];
    best.stars = best.p >= .75 ? 5 : best.p >= .66 ? 4 : best.p >= .57 ? 3 : best.p >= .48 ? 2 : 1;
    return (m._tip = best);
  }
  const stars = n => `<span class="stars" role="img" aria-label="${n}/5">${'★'.repeat(n)}<i>${'★'.repeat(5 - n)}</i></span>`;

  function ob(m, k, label) {
    const o = m.o[k];
    if (!o) return '<span class="ob off"><b>–</b></span>';
    const on = slip.some(s => s.m === m.id && s.k === k);
    return `<button type="button" class="ob${on ? ' on' : ''}" data-m="${m.id}" data-k="${k}" aria-pressed="${on}"><small>${esc(label || mkShort(k, m))}</small><b>${o.toFixed(2)}</b></button>`;
  }
  const RL = () => ({ W: t('th_w'), D: t('th_d'), L: t('th_l') });
  const formDots = arr => { const L = RL(); return arr.map(r => `<span class="f ${r}">${esc(L[r].slice(0, 1))}</span>`).join(''); };

  // ---------- serit (yatay kaydirilan ciplar) ----------
  const strip = (inner, cls) => `<div class="strip ${cls || ''}"><button type="button" class="sarrow l" data-scroll="-1" aria-label="‹">‹</button><div class="chips">${inner}</div><button type="button" class="sarrow r" data-scroll="1" aria-label="›">›</button></div>`;
  function syncStrips() {
    document.querySelectorAll('.strip').forEach(s => {
      const c = s.querySelector('.chips'), on = c.querySelector('.on');
      if (on && !s.dataset.ready) c.scrollLeft = Math.max(0, on.offsetLeft - c.offsetLeft - (c.clientWidth - on.offsetWidth) / 2);
      s.dataset.ready = '1';
      const upd = () => {
        s.querySelector('.sarrow.l').hidden = c.scrollLeft < 4;
        s.querySelector('.sarrow.r').hidden = c.scrollLeft + c.clientWidth > c.scrollWidth - 4;
      };
      c.onscroll = upd; upd();
    });
  }
  function dayStrip(days) {
    return strip(`<button class="chip day ${flt.day === 'all' ? 'on' : ''}" data-day="all"><small>${t('alldays_s')}</small>${t('all')}</button>` +
      days.map(d => { const p = keyParts(d); return `<button class="chip day ${flt.day === d ? 'on' : ''}" data-day="${d}"><small>${relDay(d) || t('wd')[p.wd]}</small>${dayShort(d)}</button>`; }).join(''), 'days');
  }
  function pickDay(list) {
    const days = [...new Set(list.map(m => dayKey(m.d)))].sort();
    if (flt.day !== 'all' && !days.includes(flt.day)) flt.day = days[0] || 'all';
    return days;
  }

  // ---------- kabuk ----------
  const ICON = {
    bulletin: '<circle cx="12" cy="12" r="9"/><path d="M12 7l4 3-1.5 5h-5L8 10z"/>',
    basketball: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18 M12 3v18 M5.6 5.6c3 3 3 9.8 0 12.8 M18.4 5.6c-3 3-3 9.8 0 12.8"/>',
    analysis: '<path d="M4 19V5 M4 19h16 M8 15l3-4 3 2 4-6"/>',
    tables: '<path d="M5 4h14v4a7 7 0 0 1-14 0z M9 20h6 M12 15v5"/>',
    results: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
    mycoupons: '<path d="M5 4h14v16l-3-2-2 2-2-2-2 2-2-2-3 2z M9 9h6 M9 13h6"/>'
  };
  const NAV = [['bulletin', '#/'], ['basketball', '#/basketbol'], ['analysis', '#/analiz'], ['tables', '#/puan'], ['results', '#/sonuclar'], ['mycoupons', '#/kuponlarim']];

  function renderChrome() {
    const h = location.hash || '#/';
    const act = k => (k === 'bulletin' ? (h === '#/' || h === '#' || h.startsWith('#/mac')) : h.startsWith(NAV.find(n => n[0] === k)[1]));
    $('nav').innerHTML = NAV.map(([k, u]) => `<a href="${u}" class="${act(k) ? 'on' : ''}" ${act(k) ? 'aria-current="page"' : ''}>${t(k)}${k === 'bulletin' || k === 'basketball' ? `<span class="lvn" data-sport="${k === 'bulletin' ? 'fb' : 'bb'}" hidden></span>` : ''}</a>`).join('')
      + `<a href="#/mollamyrat" class="mm ${h.startsWith('#/mollamyrat') ? 'on' : ''}">★ MollaMyrat</a>`;
    $('tabs').innerHTML = NAV.map(([k, u]) => `<a href="${u}" class="${act(k) ? 'on' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg><span>${t(k + '_s') !== k + '_s' ? t(k + '_s') : t(k)}</span></a>`).join('');
    $('bal').innerHTML = user
      ? `<span class="av">${esc(user.slice(0, 1).toUpperCase())}</span><span class="bt"><small>${esc(user)}</small><b>${money(balance)}</b></span>`
      : `<span class="av">👤</span><span class="bt"><b class="lg lg-l">${t('login_or')}</b><b class="lg lg-s">${t('login')}</b></span>`;
    $('bal').setAttribute('aria-label', t('profile'));
    const up = D.updated ? `${shortDate(D.updated)}.${dayKey(D.updated).slice(0, 4)} ${timeOf(D.updated)}` : '-';
    $('foot').innerHTML = `
      <div class="fl"><span class="age">18+</span><span>${t('foot_18')}</span></div>
      <div class="fl"><span>${t('foot_disc')}</span></div>
      <div class="fl"><a href="#/kurallar">${t('rules')}</a><span>${t('updated')}: ${up}</span><span>${t('tznote')}</span><span>© ${new Date().getFullYear()} Ahal365</span></div>`;
    document.documentElement.lang = lang;
    $('lang').value = lang;
    $('slip').setAttribute('aria-label', t('coupon'));
  }

  function renderSide() {
    const up = upcoming();
    const cnt = {}; up.forEach(m => { cnt[m.lg] = (cnt[m.lg] || 0) + 1; });
    let html = '<div class="card">';
    GROUPS.forEach(g => {
      const ls = D.leagues.filter(l => l.g === g && cnt[l.id]);
      if (!ls.length) return;
      html += `<h3>${t('g_' + g)}</h3>` + ls.map(l => `<button class="lgbtn ${flt.lg === l.id ? 'on' : ''}" data-lg="${l.id}">${badge(l.id)}<span class="ln">${esc(ln(l.id))}</span><span class="cnt">${cnt[l.id]}</span></button>`).join('');
    });
    $('side').innerHTML = html + '</div>';
  }
  function lgChips(ids, always) {
    return strip(D.leagues.filter(l => ids.has(l.id)).map(l => `<button class="chip ${flt.lg === l.id ? 'on' : ''}" data-lg="${l.id}">${esc(ln(l.id))}</button>`).join(''), always ? '' : 'lgchips');
  }

  // ---------- MollaMyrat'in kuponu (veri betigi uretir, haftalik takip edilir) ----------
  const MOLLA = D.molla || { today: '', coupons: [] };
  const pkName = (pk, side) => (D.teams[pk[side]] ? ts(pk[side]) : pk[side + 'n']);
  // sonuc: veri betiginin isledigi ya da canli akistan gelen mac sonucu
  function pkOk(pk, score) {
    if (pk.ok !== undefined) return pk.ok;
    const r = RES[pk.id];
    if (!r) return null;
    return score ? (r.hs === pk.sc[0] && r.as === pk.sc[1]) : wins(pk.k, r.hs, r.as);
  }
  const pkRes = pk => pk.res || (RES[pk.id] ? [RES[pk.id].hs, RES[pk.id].as] : null);
  const pkIcon = (pk, score) => { const ok = pkOk(pk, score); return ok === true ? '<span class="mst ok" title="✓">✓</span>' : ok === false ? '<span class="mst no" title="✗">✗</span>' : '<span class="mst wait" title="…">•</span>'; };
  const cRange = c => (c.until && c.until !== c.date ? dayShort(c.date) + ' – ' + dayShort(c.until) : dayLabel(c.date));
  const pkLive = pk => MATCH[pk.id] && future(MATCH[pk.id]) && MATCH[pk.id].o[pk.k];
  function weekRange(off) {
    const k = dayKey(Date.now()), p = keyParts(k), [y, m, d] = k.split('-').map(Number);
    const base = Date.UTC(y, m - 1, d, 12) - ((p.wd + 6) % 7) * 864e5 + off * 7 * 864e5;
    const f = ms => new Date(ms).toISOString().slice(0, 10);
    return [f(base), f(base + 6 * 864e5)];
  }
  function weekStats(off) {
    const [a, b] = weekRange(off), cs = MOLLA.coupons.filter(c => c.date >= a && c.date <= b);
    const r = { a, b, cs, ok: 0, no: 0, wait: 0, sok: 0, sno: 0, swait: 0 };
    cs.forEach(c => {
      c.picks.forEach(x => { const ok = pkOk(x); if (ok === true) r.ok++; else if (ok === false) r.no++; else r.wait++; });
      (c.scores || []).forEach(x => { const ok = pkOk(x, true); if (ok === true) r.sok++; else if (ok === false) r.sno++; else r.swait++; });
    });
    return r;
  }
  function molRow(pk, score) {
    const lg = LG[pk.lg] ? esc(ln(pk.lg)) : '';
    const tag = MATCH[pk.id] ? 'a' : 'div', href = MATCH[pk.id] ? ` href="#/mac/${pk.id}"` : '';
    const right = score
      ? `<span class="to num">${pk.sc[0]} - ${pk.sc[1]}<small>${pct(pk.sp)}%</small></span>`
      : `<span class="to num">${pk.o.toFixed(2)}</span>`;
    const sub = score ? `${shortDate(pk.d)} ${timeOf(pk.d)} · ${lg}` : `${shortDate(pk.d)} ${timeOf(pk.d)} · ${esc(mkLabel(pk.k))} · ${t('m_pred')} ${pk.sc[0]}-${pk.sc[1]}`;
    const res = pkRes(pk);
    return `<${tag} class="tipc-r"${href}><span class="tt">${pair(pk.h, pk.a, pkName(pk, 'h'), pkName(pk, 'a'))}<small>${sub}${res ? ' · <b class="res">' + res[0] + '-' + res[1] + '</b>' : `<span data-lv="${pk.id}"></span>`}</small></span>${right}${pkIcon(pk, score)}</${tag}>`;
  }
  function tipCoupon() {
    const c = MOLLA.coupons[0];
    if (!c) return '';
    const tot = c.picks.reduce((p, x) => p * x.o, 1), w = weekStats(0);
    return `<div class="card tipc"><div class="tipc-h"><b>★ ${t('tipc_title')}</b><small>${fmt(t('tipc_sub'), { n: c.picks.length })} · ${cRange(c)}</small></div>
      ${c.picks.map(x => molRow(x)).join('')}
      <div class="tipc-f"><div class="sum"><span>${t('total_odds')}</span><b class="num">${tot.toFixed(2)}</b></div>
      <div class="sum"><span>${fmt(t('tipc_min'), { s: MIN_STAKE })}</span><b class="num" style="color:var(--pri)">${money(Math.min(MIN_STAKE * tot, MAX_WIN))}</b></div>
      <div class="sum"><span>${t('m_week')}</span><b class="num"><span style="color:var(--pri)">${w.ok} ✓</span> · <span style="color:var(--red)">${w.no} ✗</span> · ${w.wait} •</b></div>
      ${c.picks.some(pkLive) ? `<button class="btn" data-act="tipadd">${t('tipc_add')}</button>` : ''}
      <a class="btn ghost" href="#/mollamyrat">${t('m_track')} →</a></div></div>`;
  }
  function viewMolla() {
    const w = weekStats(0), lw = weekStats(-1), c0 = MOLLA.coupons[0];
    const rate = (o, n) => (o + n ? pct(o / (o + n)) + '%' : '–');
    const box = x => `<div class="kpis m5">
      <div class="kpi"><small>${t('m_ok')}</small><b style="color:var(--pri)">${x.ok}</b></div>
      <div class="kpi"><small>${t('m_no')}</small><b style="color:var(--red)">${x.no}</b></div>
      <div class="kpi"><small>${t('m_wait')}</small><b>${x.wait}</b></div>
      <div class="kpi"><small>${t('m_rate')}</small><b style="color:var(--gold)">${rate(x.ok, x.no)}</b></div>
      <div class="kpi"><small>${t('m_score_hit')}</small><b>${x.sok}/${x.sok + x.sno}</b></div></div>`;
    const cpn = c => {
      const o = c.picks.filter(x => pkOk(x) === true).length, n = c.picks.filter(x => pkOk(x) === false).length;
      const st = n ? 'lost' : (o === c.picks.length ? 'won' : 'pending');
      return `<div class="card tipc mc"><div class="tipc-h row"><b>${cRange(c)}</b><span class="st ${st}">${t(st)}</span><small class="num">${o} ✓ · ${n} ✗ · ${c.picks.length - o - n} •</small></div>${c.picks.map(x => molRow(x)).join('')}</div>`;
    };
    const range = x => `${dayShort(x.a)} – ${dayShort(x.b)}`;
    return `<div class="pagehead"><h1>★ ${t('tipc_title')}</h1><small>${t('m_note')}</small></div>
      <div class="card sec" style="margin-top:0"><h2>${t('m_week')} <small class="mut num">${range(w)}</small></h2>${box(w)}</div>
      ${c0 && c0.scores && c0.scores.length ? `<div class="card tipc mc"><div class="tipc-h"><b>${t('m_scores')}</b><small>${cRange(c0)}</small></div>${c0.scores.map(x => molRow(x, true)).join('')}</div>` : ''}
      <h2 class="dayhead">${t('m_coupons')}</h2>
      ${w.cs.length ? w.cs.map(cpn).join('') : `<div class="card empty">${t('m_none')}</div>`}
      ${lw.cs.length ? `<div class="card sec"><h2>${t('m_last')} <small class="mut num">${range(lw)}</small></h2>${box(lw)}</div><details class="lastw"><summary>${t('m_last')} · ${t('m_coupons')}</summary>${lw.cs.map(cpn).join('')}</details>` : ''}`;
  }

  // ---------- profil / uyelik (demo: bu cihazda saklanir) ----------
  async function sha(txt) {
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
      return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
    let h = 5381; for (let i = 0; i < txt.length; i++) h = ((h << 5) + h + txt.charCodeAt(i)) >>> 0;
    return 'x' + h.toString(16);
  }
  async function doRegister(f) {
    const u = f.username.value.trim(), pw = f.password.value;
    let e = '';
    if (!/^[A-Za-z0-9_]{3,20}$/.test(u)) e = t('e_user');
    else if (users[u.toLowerCase()]) e = t('e_taken');
    else if (pw.length < 6) e = t('e_pass');
    else if (pw !== f.password2.value) e = t('e_match');
    else if (!f.age.checked) e = t('e_age');
    if (e) { authErr.reg = e; return render(); }
    const salt = Math.random().toString(36).slice(2);
    users[u.toLowerCase()] = { name: u, phone: f.phone.value.trim(), salt, hash: await sha(salt + pw), since: Date.now() };
    LS.set('users', users); user = u.toLowerCase(); LS.set('user', user); authErr = { login: '', reg: '' };
    loadUser(); saveUser(); toast(fmt(t('welcome'), { n: u })); render();
  }
  async function doLogin(f) {
    const u = users[f.username.value.trim().toLowerCase()];
    if (!u || u.hash !== await sha(u.salt + f.password.value)) { authErr.login = t('e_login'); return render(); }
    user = f.username.value.trim().toLowerCase(); LS.set('user', user); authErr = { login: '', reg: '' };
    loadUser(); settle(); toast(fmt(t('welcome'), { n: u.name })); render();
  }
  function viewProfile() {
    if (!user) {
      return `<div class="pagehead"><h1>${t('profile')}</h1></div><div class="grid2" style="margin-top:0">
        <form class="card sec auth" data-form="login" novalidate><h2>${t('login')}</h2>
          <label>${t('username')}<input name="username" autocomplete="username" required></label>
          <label>${t('password')}<input name="password" type="password" autocomplete="current-password" required></label>
          <div class="err" role="alert">${esc(authErr.login)}</div><button class="btn" type="submit">${t('login')}</button></form>
        <form class="card sec auth" data-form="reg" novalidate><h2>${t('register')}</h2>
          <label>${t('username')}<input name="username" autocomplete="username" maxlength="20" required></label>
          <label>${t('phone')}<input name="phone" type="tel" autocomplete="tel" placeholder="+993"></label>
          <label>${t('password')}<input name="password" type="password" autocomplete="new-password" required></label>
          <label>${t('password2')}<input name="password2" type="password" autocomplete="new-password" required></label>
          <label class="chk"><input name="age" type="checkbox"> <span>${t('age_ok')}</span></label>
          <div class="err" role="alert">${esc(authErr.reg)}</div><button class="btn" type="submit">${t('register')}</button></form>
      </div><p class="note">${t('demo_acc')}</p>`;
    }
    const u = users[user], n = k => coupons.filter(c => c.status === k).length;
    return `<div class="pagehead"><h1>${t('profile')}</h1></div>
      <div class="card sec" style="margin-top:0"><div class="prof"><span class="av big">${esc(u.name.slice(0, 1).toUpperCase())}</span>
        <div><b>${esc(u.name)}</b><small class="mut">${u.phone ? esc(u.phone) + ' · ' : ''}${t('member_since')}: ${shortDate(u.since)}.${new Date(u.since).getFullYear()}</small></div>
        <button class="chip" style="margin-left:auto" data-act="logout">${t('logout')}</button></div>
        <div class="kpis m5" style="margin-top:14px">
          <div class="kpi"><small>${t('demo_balance')}</small><b style="color:var(--pri)">${money(balance)}</b></div>
          <div class="kpi"><small>${t('st_total')}</small><b>${coupons.length}</b></div>
          <div class="kpi"><small>${t('won')}</small><b style="color:var(--pri)">${n('won')}</b></div>
          <div class="kpi"><small>${t('lost')}</small><b style="color:var(--red)">${n('lost')}</b></div>
          <div class="kpi"><small>${t('pending')}</small><b>${n('pending')}</b></div></div>
        <div class="prof-a"><a class="btn" href="#/kuponlarim">${t('mycoupons')}</a><button class="btn ghost" data-act="resetbal">${t('reset_balance')}</button></div>
      </div><p class="note">${t('demo_acc')}</p>`;
  }

  // ---------- bulten ----------
  function viewBulletin() {
    const up = upcoming();
    const inLg = up.filter(m => flt.lg === 'all' || m.lg === flt.lg);
    const days = pickDay(inLg);
    return `<div class="pagehead"><h1>${t('bulletin')}</h1><small>${t('tznote')}</small></div>
      ${dayStrip(days)}${lgChips(new Set(up.map(m => m.lg)))}
      <div class="searchrow"><input id="q" type="search" placeholder="${t('search')}" value="${esc(flt.q)}" autocomplete="off" aria-label="${t('search')}"></div>
      <details class="tipmob"><summary>★ ${t('tipc_title')}</summary>${tipCoupon()}</details>
      <div id="livebox" data-sport="fb">${liveBox('fb')}</div>
      <div id="blist">${bulletinList()}</div>`;
  }
  function bulletinList() {
    const q = flt.q.trim().toLocaleLowerCase();
    const hit = id => { const x = team(id); return (x.n + ' ' + (x[lang] || '')).toLocaleLowerCase().includes(q); };
    const list = upcoming().filter(m => (flt.lg === 'all' || m.lg === flt.lg)
      && (q ? (hit(m.h) || hit(m.a)) : (flt.day === 'all' || dayKey(m.d) === flt.day)));
    if (!list.length) return `<div class="card empty">${t('nomatch')}</div>`;
    let html = '';
    const order = {}; D.leagues.forEach((l, i) => { order[l.id] = i; });
    [...new Set(list.map(m => dayKey(m.d)))].sort().forEach(dk => {
      const ms = list.filter(m => dayKey(m.d) === dk).sort((a, b) => byDate(a, b) || order[a.lg] - order[b.lg]);
      html += `<h2 class="dayhead">${dayLabel(dk)} <small>${ms.length} ${t('selections')}</small></h2><section class="card lgblock">
        <div class="mkhead"><span></span><span>${t('ms')}</span><span>${t('ou')} 2.5</span><span>${t('btts')}</span><span></span></div>
        ${ms.map(row).join('')}</section>`;
    });
    return html;
  }
  function row(m) {
    return `<div class="mrow">
      <a class="minfo" href="#/mac/${m.id}">
        <div class="mtime num">${timeOf(m.d)}<small>${srcBadge(m.src)}</small></div>
        <div class="mteams"><div class="mlg">${badge(m.lg)}<span>${esc(ln(m.lg))}</span></div><div class="tm">${logo(m.h)}<span>${esc(tn(m.h))}</span></div><div class="tm">${logo(m.a)}<span>${esc(tn(m.a))}</span></div></div>
      </a>
      <div class="og c3 ms">${ob(m, '1')}${ob(m, 'X')}${ob(m, '2')}</div>
      <div class="og c2 ou">${ob(m, 'U2.5', t('under'))}${ob(m, 'O2.5', t('over'))}</div>
      <div class="og c2 kg">${ob(m, 'KGV')}${ob(m, 'KGY')}</div>
      <a class="morebtn" href="#/mac/${m.id}" title="${t('detail')} · ${t('more')}" aria-label="${t('detail')}: ${esc(tn(m.h))} – ${esc(tn(m.a))}">+${Object.keys(m.o).length - 3}</a>
    </div>`;
  }

  // ---------- analiz listesi ----------
  const pbar = p => `<div class="pbar num"><div class="p1" style="flex:${p.p1}">${pct(p.p1)}%</div><div class="px" style="flex:${p.px}">${pct(p.px)}%</div><div class="p2" style="flex:${p.p2}">${pct(p.p2)}%</div></div>`;
  function viewAnalysis() {
    const up = upcoming();
    const inLg = up.filter(m => flt.lg === 'all' || m.lg === flt.lg);
    const days = pickDay(inLg);
    const list = inLg.filter(m => flt.day === 'all' || dayKey(m.d) === flt.day).sort(byDate);
    let html = `<div class="pagehead"><h1>${t('analysis')}</h1><small>${t('foot_disc')}</small></div>${dayStrip(days)}${lgChips(new Set(up.map(m => m.lg)), true)}`;
    if (!list.length) return html + `<div class="card empty">${t('nomatch')}</div>`;
    const more = list.length - flt.alim;
    return html + '<div class="acards">' + list.slice(0, flt.alim).map(m => {
      const tp = tipOf(m), p = m.p;
      return `<a class="card acard" href="#/mac/${m.id}">
        <div class="top-l"><span>${badge(m.lg)} ${esc(ln(m.lg))}</span><span class="num">${shortDate(m.d)} ${timeOf(m.d)}</span></div>
        <div class="teams"><div class="tm">${logo(m.h)}<span>${esc(ts(m.h))}</span></div><div class="ps">${p.score[0]} - ${p.score[1]}</div><div class="tm">${logo(m.a)}<span>${esc(ts(m.a))}</span></div></div>
        ${pbar(p)}
        <div class="top-l"><span>${t('tip')}: <b style="color:var(--tx)">${esc(mkLabel(tp.k))}</b> · <span class="num">${tp.o.toFixed(2)}</span></span>${stars(tp.stars)}</div>
      </a>`;
    }).join('') + '</div>' + (more > 0 ? `<button class="btn ghost more" data-act="amore">${fmt(t('show_more'), { n: more })}</button>` : '');
  }

  // ---------- mac detay ----------
  const backLink = () => `<a class="back" href="#/" data-back="1">← ${t('back')}</a>`;
  function viewMatch(id) {
    const m = MATCH[id];
    if (!m || m.sport === 'bb') return `${backLink()}<div class="card empty">${t('no_match_found')}</div>`;
    const TABS = [['pred', t('pred')], ['odds', t('odds')], ['table', t('standings')], ['form', t('formh2h')], ['squad', t('lineups')], ['players', t('players')]];
    let body = '';
    if (dtab === 'pred') body = tabPred(m);
    else if (dtab === 'odds') body = tabOdds(m);
    else if (dtab === 'table') body = `<div class="card sec">${tableHtml(m.lg, [m.h, m.a])}</div>`;
    else if (dtab === 'form') body = tabForm(m);
    else if (dtab === 'squad') body = tabSquad(m);
    else body = tabPlayers(m);
    return `${backLink()}
      <div class="card" style="overflow:hidden">
        <div class="hero">
          <div class="meta">${badge(m.lg)} ${esc(ln(m.lg))} · ${dayLabel(dayKey(m.d))} · ${timeOf(m.d)}${m.v ? ' · ' + esc(m.v) : ''}</div>
          <div class="vs">
            <div class="side-t">${logo(m.h)}<span>${esc(tn(m.h))}</span><span class="frm">${formDots(m.f.h.slice(0, 5).map(x => x.r).reverse())}</span></div>
            <div class="mid" data-lvh="${m.id}">${timeOf(m.d)}<small>${shortDate(m.d)}</small></div>
            <div class="side-t">${logo(m.a)}<span>${esc(tn(m.a))}</span><span class="frm">${formDots(m.f.a.slice(0, 5).map(x => x.r).reverse())}</span></div>
          </div>
        </div>
        <div class="dtabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" aria-selected="${dtab === k}" class="${dtab === k ? 'on' : ''}" data-dtab="${k}">${l}</button>`).join('')}</div>
      </div>${body}`;
  }
  const srcNote = m => (m.src === 'model' ? t('src_note_m') : fmt(t('src_note_s'), { s: srcName(m.src) }));

  function comments(m) {
    const p = m.p, out = [], f2 = n => n.toFixed(2), H = tn(m.h), A = tn(m.a);
    if (Math.abs(p.p1 - p.p2) >= .12) out.push(fmt(t('x_fav'), { t: p.p1 > p.p2 ? H : A, p: pct(Math.max(p.p1, p.p2)) }));
    else out.push(fmt(t('x_even'), { a: pct(p.p1), b: pct(p.p2) }));
    const tb = D.tables[m.lg];
    if (tb) {
      const ra = tb.all.findIndex(r => r.t === m.h) + 1, rb = tb.all.findIndex(r => r.t === m.a) + 1;
      if (ra && rb) out.push(fmt(t('x_rank'), { a: H, ra, b: A, rb }));
    }
    const sh = m.st.h, sa = m.st.a;
    if (sh.p) out.push(fmt(t('x_home'), { t: H, n: sh.p, w: sh.w, d: sh.d, l: sh.l, gf: f2(sh.gf / sh.p), ga: f2(sh.ga / sh.p) }));
    if (sa.p) out.push(fmt(t('x_away'), { t: A, n: sa.p, w: sa.w, d: sa.d, l: sa.l, gf: f2(sa.gf / sa.p), ga: f2(sa.ga / sa.p) }));
    const L = RL();
    [[H, m.f.h], [A, m.f.a]].forEach(([nm, f]) => {
      const l5 = f.slice(0, 5); if (!l5.length) return;
      const pts = l5.reduce((s, x) => s + (x.r === 'W' ? 3 : x.r === 'D' ? 1 : 0), 0);
      out.push(fmt(t('x_form'), { n: l5.length, t: nm, pts, f: l5.map(x => L[x.r].slice(0, 1)).reverse().join('-') }));
    });
    const xg = f2(p.lh + p.la);
    out.push(p.o25 >= .5 ? fmt(t('x_goals_hi'), { x: xg, p: pct(p.o25) }) : fmt(t('x_goals_lo'), { x: xg, p: pct(1 - p.o25) }));
    out.push(fmt(t('x_btts'), { p: pct(p.btts) }));
    if (m.h2h.length) {
      let w = 0, d = 0, l = 0;
      m.h2h.forEach(g => { const hg = g.h === m.h ? g.hs : g.as, ag = g.h === m.h ? g.as : g.hs; if (hg > ag) w++; else if (hg < ag) l++; else d++; });
      out.push(fmt(t('x_h2h'), { n: m.h2h.length, a: H, w, b: A, l, d }));
    }
    [[H, m.pl.h], [A, m.pl.a]].forEach(([nm, pl]) => { const top = (pl || [])[0]; if (top && top.g >= 2) out.push(fmt(t('x_scorer'), { t: nm, p: top.n, g: top.g, ap: top.ap })); });
    [[H, m.sq.h], [A, m.sq.a]].forEach(([nm, sq]) => { if (sq && sq.out.length) out.push(fmt(t('x_abs'), { t: nm, n: sq.out.length })); });
    return out;
  }

  function tabPred(m) {
    const p = m.p, tp = tipOf(m), sh = m.st.h, sa = m.st.a;
    const av = (v, n) => (n ? (v / n).toFixed(2) : '-');
    const pc = (v, n) => (n ? pct(v / n) + '%' : '-');
    const cmpRow = (a, l, b) => `<tr><td>${a}</td><td>${l}</td><td>${b}</td></tr>`;
    return `
    <div class="card sec">
      <h2>${t('pred')} ${srcBadge('model')}</h2>
      <div class="predbox">
        <div class="pscore"><small>${t('pred_score')}</small><b>${p.score[0]} - ${p.score[1]}</b><i>${t('pred_ht')}: ${p.ht[0]} - ${p.ht[1]}</i></div>
        <div>
          ${pbar(p)}
          <div class="plabels"><span>1 · ${esc(ts(m.h))}</span><span>X · ${t('draw')}</span><span>2 · ${esc(ts(m.a))}</span></div>
          <div class="kpis">
            <div class="kpi"><small>${t('xg')}</small><b>${p.lh.toFixed(2)} – ${p.la.toFixed(2)}</b></div>
            <div class="kpi"><small>${t('over')} 2.5</small><b>${pct(p.o25)}%</b></div>
            <div class="kpi"><small>${t('under')} 2.5</small><b>${pct(1 - p.o25)}%</b></div>
            <div class="kpi"><small>${t('btts')}</small><b>${pct(p.btts)}%</b></div>
          </div>
        </div>
      </div>
      <div class="tip" style="margin-top:14px">
        <div><div class="lbl">${t('tip')}</div><div class="what">${esc(mkLabel(tp.k))}</div></div>
        <div><div class="lbl">${t('confidence')} · ${pct(tp.p)}%</div>${stars(tp.stars)}</div>
        ${ob(m, tp.k)}
      </div>
    </div>
    <div class="grid2">
      <div class="card sec"><h2>${t('likely_scores')}</h2><div class="scores num">${p.top.map(s => `<span>${s[0]} - ${s[1]}<small>${(s[2] * 100).toFixed(1)}%</small></span>`).join('')}</div></div>
      <div class="card sec"><h2>${t('ms')} ${srcBadge(m.src)}</h2><div class="og c3">${ob(m, '1')}${ob(m, 'X')}${ob(m, '2')}</div><p class="note">${srcNote(m)}</p></div>
    </div>
    <div class="card sec"><h2>${t('commentary')}</h2><ul class="cmt">${comments(m).map(c => `<li>${esc(c)}</li>`).join('')}</ul><p class="note">${t('foot_disc')}</p></div>
    <div class="card sec"><h2>${t('compare')}</h2>
      <table class="cmp"><thead><tr><th>${esc(ts(m.h))} · ${t('home_rec')}</th><th></th><th>${esc(ts(m.a))} · ${t('away_rec')}</th></tr></thead><tbody>
        ${cmpRow(sh.p, t('c_played'), sa.p)}
        ${cmpRow(`${sh.w}-${sh.d}-${sh.l}`, t('c_wdl'), `${sa.w}-${sa.d}-${sa.l}`)}
        ${cmpRow(av(sh.gf, sh.p), t('c_gf'), av(sa.gf, sa.p))}
        ${cmpRow(av(sh.ga, sh.p), t('c_ga'), av(sa.ga, sa.p))}
        ${cmpRow(sh.cs, t('c_cs'), sa.cs)}
        ${cmpRow(pc(sh.o25, sh.p), t('c_o25'), pc(sa.o25, sa.p))}
        ${cmpRow(pc(sh.btts, sh.p), t('c_btts'), pc(sa.btts, sa.p))}
      </tbody></table>
    </div>`;
  }

  function tabOdds(m) {
    const grp = (title, ks, cols, src) => `<div class="card sec"><h2>${title} ${srcBadge(src)}</h2><div class="og c${cols}">${ks.map(k => ob(m, k)).join('')}</div></div>`;
    return grp(t('ms'), ['1', 'X', '2'], 3, m.src) + grp(t('dc'), ['1X', '12', 'X2'], 3, m.src === 'bet365' ? 'bet365' : 'model')
      + grp(t('ou') + ' 2.5', ['U2.5', 'O2.5'], 2, m.ou || 'model')
      + grp(t('ou'), ['U1.5', 'O1.5', 'U3.5', 'O3.5'], 2, 'model')
      + grp(t('btts'), ['KGV', 'KGY'], 2, 'model')
      + `<p class="note">${srcNote(m)}</p>`;
  }

  function tabForm(m) {
    const L = RL();
    const fl = (id, f) => `<div class="card sec"><h2>${logo(id)} ${esc(tn(id))} · ${t('last_matches')}</h2><div class="gl">${f.length ? f.map(g =>
      `<div class="g"><span class="f ${g.r}">${esc(L[g.r].slice(0, 1))}</span><span class="mut num">${shortDate(g.d)}</span>
       <span class="o">${logo(g.o, 'sm')} ${g.ha === 'H' ? '' : '<span class="mut">@</span> '}${esc(tn(g.o))} <small class="mut">${esc(ln(g.lg))}</small></span><span class="sc">${g.gf} - ${g.ga}</span></div>`).join('') : `<div class="empty">–</div>`}</div></div>`;
    const h2h = m.h2h.length ? `<div class="gl h2h">${m.h2h.map(g => `<div class="g"><span class="mut num">${shortDate(g.d)}.${g.d.slice(2, 4)}</span><span class="o">${esc(tn(g.h))} ${logo(g.h, 'sm')}</span><span class="sc">${g.hs} - ${g.as}</span><span class="o">${logo(g.a, 'sm')} ${esc(tn(g.a))}</span></div>`).join('')}</div>` : `<div class="empty">${t('no_h2h')}</div>`;
    return `<div class="grid2">${fl(m.h, m.f.h)}${fl(m.a, m.f.a)}</div><div class="card sec"><h2>${t('h2h')}</h2>${h2h}</div>`;
  }

  function prank(p) {
    const a = (p.p || '').toUpperCase();
    if (a === 'G' || a === 'GK') return 0;
    if (a.startsWith('DM')) return 2;
    if (/^(CD|CB|LB|RB|SW|D|LWB|RWB)/.test(a)) return 1;
    if (a.startsWith('AM') || /^(LW|RW)$/.test(a)) return 4;
    if (/^(CM|LM|RM|M)/.test(a)) return 3;
    if (/^(F|CF|S|LF|RF)/.test(a)) return 5;
    return 3;
  }
  const pside = p => { const a = (p.p || '').toUpperCase(); return /-L$/.test(a) || /^L/.test(a) ? 0 : /-R$/.test(a) || /^R/.test(a) ? 2 : 1; };
  const pname = n => (n.length <= 13 ? n : n.split(' ').slice(-1)[0]);
  function pitch(sq) {
    const xi = sq.xi.slice().sort((a, b) => prank(a) - prank(b));
    const nums = (sq.f || '').split('-').map(Number).filter(n => n > 0);
    let rows = [];
    if (xi.length === 11 && nums.reduce((s, n) => s + n, 0) === 10) {
      let i = 0; [1].concat(nums).forEach(n => { rows.push(xi.slice(i, i + n)); i += n; });
    } else {
      const g = {}; xi.forEach(p => { const r = Math.min(prank(p), 5); (g[r] = g[r] || []).push(p); });
      rows = Object.keys(g).sort().map(k => g[k]);
    }
    return `<div class="pitch">${rows.map(r => `<div class="prow">${r.sort((a, b) => pside(a) - pside(b)).map(p => `<div class="pl"><i>${esc(p.j)}</i><span>${esc(pname(p.n))}</span></div>`).join('')}</div>`).join('')}</div>`;
  }
  function tabSquad(m) {
    const one = (id, sq) => {
      if (!sq) return `<div class="card sec"><div class="sqhead">${logo(id)} ${esc(tn(id))}</div><div class="empty">${t('no_lineup')}</div></div>`;
      return `<div class="card sec"><div class="sqhead">${logo(id)} ${esc(tn(id))}<small class="num">${esc(sq.f)}</small></div>
        ${pitch(sq)}
        <p class="note">${t('probable_note')}: ${esc(tn(sq.o))}, ${shortDate(sq.d)}</p>
        <h2 style="margin-top:14px">${t('absent')}</h2>
        ${sq.out.length ? `<ul class="outl">${sq.out.map(o => `<li class="${o.w}"><span><b>${esc(o.n)}</b> <small>— ${t('w_' + o.w)}</small></span></li>`).join('')}</ul>` : `<div class="mut">${t('no_absent')}</div>`}
      </div>`;
    };
    return `<div class="pagehead" style="margin:14px 0 0"><h1 style="font-size:16px">${t('probable')}</h1></div>
      <div class="grid2">${one(m.h, m.sq.h)}${one(m.a, m.sq.a)}</div><p class="note">${t('absent_note')}</p>`;
  }
  function tabPlayers(m) {
    const one = (id, pl) => `<div class="card sec"><div class="sqhead">${logo(id)} ${esc(tn(id))}</div>${pl && pl.length ? `<div class="tblwrap"><table class="tbl pls"><thead><tr>
      <th class="tn">${t('ph_player')}</th><th title="${t('c_played')}">${t('ph_ap')}</th><th>${t('ph_g')}</th><th>${t('ph_a')}</th><th>${t('ph_sh')}</th><th title="${t('ph_yc_l')}"><span class="card-y"></span></th><th title="${t('ph_rc_l')}"><span class="card-r"></span></th></tr></thead><tbody>
      ${pl.map(p => `<tr><td class="tn"><span class="jr">${esc(p.j || '–')}</span><span>${esc(p.n)}</span><small class="mut">${esc(p.p)}</small></td><td>${p.ap}</td><td class="pts">${p.g}</td><td>${p.a}</td><td>${p.sh}</td><td>${p.yc}</td><td>${p.rc}</td></tr>`).join('')}
      </tbody></table></div>` : `<div class="empty">${t('pl_none')}</div>`}</div>`;
    return `<div class="pagehead" style="margin:14px 0 0"><h1 style="font-size:16px">${t('pl_title')}</h1><small>${esc(ln(m.lg))} · ${t('pl_note')}</small></div>
      <div class="grid2">${one(m.h, m.pl.h)}${one(m.a, m.pl.a)}</div>`;
  }

  // ---------- puan durumu ----------
  function tableHtml(lg, hl) {
    const tb = D.tables[lg];
    if (!tb) return `<div class="empty">${t('no_table')}</div>`;
    const rows = tb[ttab] || tb.all;
    return `<div class="seg" role="tablist">${['all', 'home', 'away'].map(k => `<button class="${ttab === k ? 'on' : ''}" data-ttab="${k}">${t('t_' + k)}</button>`).join('')}</div>
      <div class="tblwrap"><table class="tbl"><thead><tr><th>#</th><th class="tn">${t('th_team')}</th><th>${t('th_p')}</th><th>${t('th_w')}</th><th>${t('th_d')}</th><th>${t('th_l')}</th><th>${t('th_g')}</th><th>${t('th_gd')}</th><th>${t('th_pts')}</th><th>${t('th_form')}</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr class="${hl && hl.includes(r.t) ? 'hl' : ''}"><td>${i + 1}</td><td class="tn">${logo(r.t)}<span>${esc(tn(r.t))}</span></td><td>${r.p}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td>${r.gf}:${r.ga}</td><td>${r.gf - r.ga > 0 ? '+' : ''}${r.gf - r.ga}</td><td class="pts">${r.pts}</td><td><span class="fr">${formDots(r.f)}</span></td></tr>`).join('')}
      </tbody></table></div>`;
  }
  function viewTables() {
    const has = D.leagues.filter(l => D.tables[l.id]);
    const lg = flt.lg !== 'all' && D.tables[flt.lg] ? flt.lg : (has[0] || {}).id;
    return `<div class="pagehead"><h1>${t('tables')}</h1></div>
      ${strip(has.map(l => `<button class="chip ${lg === l.id ? 'on' : ''}" data-lg="${l.id}">${esc(ln(l.id))}</button>`).join(''))}
      <div class="card sec" style="margin-top:0">${lg ? `<h2>${badge(lg)} ${esc(ln(lg))}</h2>` + tableHtml(lg) : `<div class="empty">${t('no_table')}</div>`}</div>`;
  }

  // ---------- sonuclar ----------
  const resRow = (g, withDate) => `<div class="g"><span class="mut num">${withDate ? shortDate(g.d) : timeOf(g.d)}</span><span class="o">${esc(tn(g.h))} ${logo(g.h, 'sm')}</span><span class="sc">${g.hs} - ${g.as}</span><span class="o">${logo(g.a, 'sm')} ${esc(tn(g.a))}</span></div>`;
  function viewResults() {
    const known = new Set(D.results.map(r => r.id));
    const liveRes = liveCands().filter(m => !isBB(m) && LIVE[m.id] && LIVE[m.id].fin && !known.has(m.id))
      .map(m => ({ id: m.id, lg: m.lg, d: m.d, h: m.h, a: m.a, hs: LIVE[m.id].hs, as: LIVE[m.id].as }));
    const inLg = liveRes.concat(D.results).filter(r => flt.lg === 'all' || r.lg === flt.lg);
    const days = [...new Set(inLg.map(r => dayKey(r.d)))].sort().reverse();
    if (flt.rday === undefined || !days.includes(flt.rday)) flt.rday = days[0];
    const list = inLg.filter(r => dayKey(r.d) === flt.rday);
    let html = `<div class="pagehead"><h1>${t('results')}</h1></div>
      ${strip(days.map(d => { const p = keyParts(d); return `<button class="chip day ${flt.rday === d ? 'on' : ''}" data-rday="${d}"><small>${relDay(d) || t('wd')[p.wd]}</small>${dayShort(d)}</button>`; }).join(''), 'days')}
      ${lgChips(new Set(D.results.map(r => r.lg)), true)}`;
    if (!list.length) return html + `<div class="card empty">${t('nomatch')}</div>`;
    D.leagues.forEach(l => {
      const rs = list.filter(r => r.lg === l.id).sort(byDate);
      if (!rs.length) return;
      html += `<section class="card lgblock"><div class="lghead">${badge(l.id)}<span>${esc(ln(l.id))}</span></div><div class="pad"><div class="gl h2h">${rs.map(g => resRow(g)).join('')}</div></div></section>`;
    });
    return html;
  }

  // ---------- basketbol ----------
  function viewBasketball() {
    const up = BB.matches.filter(future).sort(byDate);
    let html = `<div class="pagehead"><h1>${t('bb_title')}</h1><small>${t('tznote')}</small></div><div id="livebox" data-sport="bb">${liveBox('bb')}</div>`;
    if (!up.length) html += `<div class="card empty">${t('bb_none')}</div>`;
    [...new Set(up.map(m => dayKey(m.d)))].sort().forEach(dk => {
      const ms = up.filter(m => dayKey(m.d) === dk);
      html += `<h2 class="dayhead">${dayLabel(dk)}</h2><section class="card lgblock"><div class="lghead"><span class="cc">NBA</span><span>NBA</span><span class="day">${ms.length} ${t('selections')}</span></div>
        <div class="mkhead bb"><span></span><span>${t('ms')}</span><span>${t('bb_total')}</span><span>${t('pred')}</span></div>
        ${ms.map(m => `<div class="mrow bb">
          <div class="minfo"><div class="mtime num">${timeOf(m.d)}<small>${srcBadge(m.src)}</small></div>
            <div class="mteams"><div class="tm">${logo(m.h)}<span>${esc(tn(m.h))}</span></div><div class="tm">${logo(m.a)}<span>${esc(tn(m.a))}</span></div></div></div>
          <div class="og c2 ms">${ob(m, '1')}${ob(m, '2')}</div>
          <div class="og c2 tot">${ob(m, 'BU')}${ob(m, 'BO')}</div>
          <div class="bbp num"><b>${m.p.score[0]} - ${m.p.score[1]}</b><small>1: ${pct(m.p.p1)}% · 2: ${pct(m.p.p2)}%</small></div>
        </div>`).join('')}</section>`;
    });
    html += `<p class="note">${t('bb_note')}</p>`;
    if (BB.table.length) html += `<div class="card sec"><h2>${t('bb_table')}</h2><div class="tblwrap"><table class="tbl"><thead><tr><th>#</th><th class="tn">${t('th_team')}</th><th>${t('th_p')}</th><th>${t('th_w')}</th><th>${t('th_l')}</th><th>${t('th_pf')}</th><th>${t('th_pa')}</th><th>${t('th_form')}</th></tr></thead><tbody>
      ${BB.table.map((r, i) => `<tr><td>${i + 1}</td><td class="tn">${logo(r.t)}<span>${esc(tn(r.t))}</span></td><td>${r.p}</td><td class="pts">${r.w}</td><td>${r.l}</td><td>${r.pf.toFixed(1)}</td><td>${r.pa.toFixed(1)}</td><td><span class="fr">${formDots(r.f)}</span></td></tr>`).join('')}</tbody></table></div></div>`;
    const rs = BB.results.slice(0, 12);
    if (rs.length) html += `<div class="card sec"><h2>${t('results')}</h2><div class="gl h2h">${rs.map(g => resRow(g, true)).join('')}</div></div>`;
    return html;
  }

  // ---------- kupon ----------
  const totalOdds = () => slip.reduce((p, s) => p * ((MATCH[s.m] || {}).o || {})[s.k], 1);
  function cleanSlip() {
    const n = slip.length;
    slip = slip.filter(s => MATCH[s.m] && MATCH[s.m].o[s.k] && future(MATCH[s.m]));
    if (slip.length !== n) LS.set('slip', slip);
    return n - slip.length;
  }
  const sideTip = () => (/^#\/mollamyrat/.test(location.hash) ? '' : tipCoupon());
  function renderSlip() {
    const n = slip.length, tot = n ? totalOdds() : 0;
    document.body.classList.toggle('hasslip', n > 0);
    $('slipbar').innerHTML = `<span class="n">${n}</span><span>${t('coupon')}</span><span class="o num">${tot.toFixed(2)}</span>`;
    const head = `<div class="sliphead"><span>${t('coupon')}</span><span class="badge">${n}</span><span class="type">${n ? (n === 1 ? t('single') : t('combo')) : ''}</span>${n ? `<button class="clr" data-act="clear">${t('clear')}</button>` : ''}<button class="x" data-act="close" aria-label="×">×</button></div>`;
    if (!n) { $('slip').innerHTML = `<div class="card bs">${head}<div class="empty">${t('slip_empty')}</div></div>${sideTip()}`; return; }
    // kompakt satirlar: ayni anda en az 10 mac gorunur; bedel/oyna alani altta sabit kalir
    $('slip').innerHTML = `<div class="card bs">${head}
      <div class="sels">${slip.map((s, i) => { const m = MATCH[s.m]; return `<div class="sel"><span class="no">${i + 1}</span><div class="sc">
        <div class="r1">${pair(m.h, m.a, ts(m.h), ts(m.a))}<b>${m.o[s.k].toFixed(2)}</b></div>
        <div class="r2">${esc(mkLabel(s.k, m))} · ${shortDate(m.d)} ${timeOf(m.d)}</div></div>
        <button class="rm" data-rm="${s.m}" aria-label="×">×</button></div>`; }).join('')}</div>
      <div class="slipbody">
        <div class="stk"><label for="stake">${t('stake')}</label><input id="stake" type="number" inputmode="decimal" min="${MIN_STAKE}" max="${MAX_STAKE}" step="1" value="${esc(stake)}"><span>${CUR}</span></div>
        <div class="quick">${[20, 50, 100, 250].map(v => `<button data-q="${v}">${v}</button>`).join('')}</div>
        <div class="sum"><span>${t('total_odds')}</span><b id="s-odds">${tot.toFixed(2)}</b></div>
        <div class="sum win"><span>${t('max_win')}</span><b id="s-win"></b></div>
        <div class="err" id="s-err" role="alert">${esc(slipErr)}</div>
        <button class="btn" data-act="play">${t('play')}</button>
        <div class="slipnote">${t('min_stake')}</div>
      </div></div>${sideTip()}`;
    updWin();
  }
  function updWin() {
    const el = $('s-win'); if (!el) return;
    el.textContent = money(Math.min((parseFloat(stake) || 0) * totalOdds(), MAX_WIN));
  }
  function syncObs() {
    document.querySelectorAll('.ob[data-m]').forEach(b => {
      const on = slip.some(s => s.m === b.dataset.m && s.k === b.dataset.k);
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
    });
  }
  function toggleSel(mid, k) {
    const i = slip.findIndex(s => s.m === mid);
    if (i >= 0 && slip[i].k === k) slip.splice(i, 1);
    else if (i >= 0) slip[i].k = k;
    else { if (slip.length >= MAX_SEL) return toast(t('max_sel')); slip.push({ m: mid, k }); }
    slipErr = '';
    LS.set('slip', slip);
    syncObs(); renderSlip();
  }
  function play() {
    if (!user) { document.body.classList.remove('slipopen'); toast(t('login_first')); location.hash = '#/profil'; return; }
    if (cleanSlip()) { slipErr = t('started'); syncObs(); return renderSlip(); }
    const st = Math.round((parseFloat(stake) || 0) * 100) / 100;
    if (st < MIN_STAKE) slipErr = t('min_stake');
    else if (st > MAX_STAKE) slipErr = t('max_stake');
    else if (st > balance) slipErr = t('no_balance');
    else slipErr = '';
    if (slipErr || !slip.length) return renderSlip();
    const tot = Math.round(totalOdds() * 100) / 100;
    const c = {
      id: 'A' + Date.now().toString().slice(-9), ts: Date.now(), stake: st, odds: tot,
      win: Math.min(Math.round(st * tot * 100) / 100, MAX_WIN), status: 'pending',
      sels: slip.map(s => { const m = MATCH[s.m]; return { m: s.m, k: s.k, o: m.o[s.k], hi: m.h, ai: m.a, h: tn(m.h), a: tn(m.a), d: m.d, ln: m.line }; })
    };
    coupons.unshift(c); balance = Math.round((balance - st) * 100) / 100; slip = [];
    saveUser(); LS.set('slip', slip);
    document.body.classList.remove('slipopen');
    toast(`${t('played')} · ${c.id}`);
    if (location.hash === '#/kuponlarim') render(); else location.hash = '#/kuponlarim';
  }
  function settle() {
    let ch = false;
    coupons.forEach(c => {
      if (c.status !== 'pending') return;
      let all = true, lost = false;
      c.sels.forEach(s => {
        const r = RES[s.m];
        if (!r) { all = false; return; }
        s.res = r.hs + '-' + r.as; s.ok = wins(s.k, r.hs, r.as, s.ln);
        if (!s.ok) lost = true;
      });
      if (lost) { c.status = 'lost'; ch = true; }
      else if (all) { c.status = 'won'; balance = Math.round((balance + c.win) * 100) / 100; ch = true; }
    });
    if (ch) saveUser();
  }
  function viewCoupons() {
    if (!user) return `<div class="pagehead"><h1>${t('mycoupons')}</h1></div><div class="card empty">${t('login_need')}<br><br><a class="btn" style="max-width:260px;margin:0 auto" href="#/profil">${t('login_or')}</a></div>`;
    const nm = (s, side) => { const id = s[side + 'i']; return id && D.teams[id] ? tn(id) : s[side]; };
    let html = `<div class="pagehead"><h1>${t('mycoupons')}</h1></div>
      <div class="card cpn"><div class="cpn-h"><span class="mut">${t('demo_balance')}</span><b style="font-size:20px;color:var(--pri)" class="num">${money(balance)}</b>
      <button class="chip" style="margin-left:auto" data-act="resetbal">${t('reset_balance')}</button></div></div>`;
    if (!coupons.length) return html + `<div class="card empty">${t('no_coupons')}</div>`;
    return html + coupons.map(c => `<div class="card cpn">
      <div class="cpn-h"><b>${t('coupon_no')}: ${esc(c.id)}</b><span class="st ${c.status}">${t(c.status)}</span><span class="mut num" style="margin-left:auto">${shortDate(c.ts)} ${timeOf(c.ts)}</span></div>
      ${c.sels.map(s => `<div class="row"><span class="rl">${pair(s.hi, s.ai, nm(s, 'h'), nm(s, 'a'))}<small class="mut">${esc(mkLabel(s.k, null, s.ln))} · ${shortDate(s.d)} ${timeOf(s.d)}${s.res ? ' · ' + esc(s.res) : ''}</small></span><span class="r ${s.ok === true ? 'ok' : s.ok === false ? 'no' : ''}">${s.o.toFixed(2)}</span></div>`).join('')}
      <div class="cpn-f"><span>${t('stake')}: <b>${money(c.stake)}</b></span><span>${t('total_odds')}: <b>${c.odds.toFixed(2)}</b></span><span>${t(c.status === 'won' ? 'payout' : 'max_win')}: <b>${money(c.win)}</b></span></div>
    </div>`).join('');
  }
  const viewRules = () => `<div class="pagehead"><h1>${t('r_title')}</h1></div><div class="card rules"><ol>${t('r_items').map(x => `<li>${esc(x)}</li>`).join('')}</ol><p class="note">${t('max_win_note')}</p></div>`;

  // ---------- canli skor (tarayicidan dogrudan, dakikada bir) ----------
  const LIVE = {};            // id -> { s: 'in' | 'post', hs, as, c: saat, fin: sonuclandirilabilir }
  const RECENT = D.recent || [];
  const tsLast = {};
  const isBB = m => m.sport === 'bb';
  function liveCands(sport) {
    const now = Date.now(), seen = new Set(), out = [];
    D.matches.concat(RECENT, BB.matches).forEach(m => {
      if (seen.has(m.id)) return; seen.add(m.id);
      if (sport && (sport === 'bb') !== isBB(m)) return;
      const t0 = new Date(m.d).getTime();
      if (t0 <= now + 30e3 && t0 > now - (isBB(m) ? 4.5 : 3.3) * 3600e3) out.push(m);
    });
    return out.sort(byDate);
  }
  function liveRow(m) {
    const l = LIVE[m.id], on = l && l.s === 'in';
    const clock = !l ? t('lv_started') : l.s === 'post' ? t('lv_ft') : (l.c || t('live'));
    const lg = isBB(m) ? '<span class="cc">NBA</span><span>NBA</span>' : `${badge(m.lg)}<span>${esc(ln(m.lg))}</span>`;
    const inner = `<div class="mtime num"><b class="lclk ${on ? 'on' : ''}">${esc(clock)}</b><small>${timeOf(m.d)}</small></div>
      <div class="mteams"><div class="mlg">${lg}</div>
        <div class="tm">${logo(m.h)}<span>${esc(tn(m.h))}</span><b class="ls ${on ? 'on' : ''}">${l ? l.hs : '–'}</b></div>
        <div class="tm">${logo(m.a)}<span>${esc(tn(m.a))}</span><b class="ls ${on ? 'on' : ''}">${l ? l.as : '–'}</b></div></div>`;
    return MATCH[m.id] && !isBB(m) ? `<a class="lrow" href="#/mac/${m.id}">${inner}</a>` : `<div class="lrow">${inner}</div>`;
  }
  function liveBox(sport) {
    const cs = liveCands(sport).filter(m => sport === 'bb' || flt.lg === 'all' || m.lg === flt.lg);
    if (!cs.length) return '';
    const n = cs.filter(m => !(LIVE[m.id] && LIVE[m.id].s === 'post')).length;
    const LIM = 6, show = flt.lvall ? cs : cs.slice(0, LIM);
    return `<h2 class="dayhead lvhead"><span class="pulse"></span>${t('live')} <small>${n} ${t('selections')}</small></h2><section class="card lgblock live">${show.map(liveRow).join('')}
      ${cs.length > LIM ? `<button class="lvmore" data-act="lvall">${flt.lvall ? t('show_less') : fmt(t('show_all'), { n: cs.length })}</button>` : ''}</section>`;
  }
  function paintLive() {
    const box = $('livebox');
    if (box && !(flt.q || '').trim()) box.innerHTML = liveBox(box.dataset.sport);
    document.querySelectorAll('[data-lv]').forEach(el => {
      const l = LIVE[el.dataset.lv];
      el.innerHTML = l ? ` · <b class="ls ${l.s === 'in' ? 'on' : ''}">${l.hs}-${l.as}${l.s === 'in' && l.c ? ' <i>' + esc(l.c) + '</i>' : ''}</b>` : '';
    });
    document.querySelectorAll('[data-lvh]').forEach(el => {
      const l = LIVE[el.dataset.lvh];
      if (l) el.innerHTML = `<span class="${l.s === 'in' ? 'lsc' : ''}">${l.hs} - ${l.as}</span><small class="lclk ${l.s === 'in' ? 'on' : ''}">${esc(l.s === 'post' ? t('lv_ft') : l.c || t('live'))}</small>`;
    });
    ['fb', 'bb'].forEach(sp => {
      const n = liveCands(sp).filter(m => !(LIVE[m.id] && LIVE[m.id].s === 'post')).length;
      document.querySelectorAll(`.lvn[data-sport="${sp}"]`).forEach(el => { el.textContent = n; el.hidden = !n; });
    });
  }
  const ymd = ms => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
  let polling = false;
  async function pollLive() {
    if (polling || document.hidden) return;
    const cs = liveCands().filter(m => !(LIVE[m.id] && LIVE[m.id].s === 'post'));
    if (!cs.length) return;
    polling = true;
    const want = {}, jobs = [];
    cs.forEach(m => {
      const id = String(m.id);
      if (id[0] === 'T') {          // TheSportsDB (Turkiye / Rusya alt ligleri)
        if (Date.now() - (tsLast[id] || 0) < 110e3) return;
        tsLast[id] = Date.now();
        jobs.push(fetch('https://www.thesportsdb.com/api/v1/json/123/lookupevent.php?id=' + id.slice(1)).then(r => r.json()).then(d => {
          const e = (d.events || [])[0]; if (!e) return;
          const st = String(e.strStatus || '').toUpperCase();
          if (!st || st === 'NS' || st === 'NOT STARTED' || /POSTP|CANC|ABAN/.test(st) || e.intHomeScore == null) return;
          const fin = ['FT', 'AET', 'PEN', 'MATCH FINISHED'].includes(st);
          LIVE[id] = { s: fin ? 'post' : 'in', hs: +e.intHomeScore || 0, as: +e.intAwayScore || 0,
            c: fin ? '' : st === 'HT' ? t('ht') : (e.strProgress ? e.strProgress + "'" : st), fin: st === 'FT' || st === 'MATCH FINISHED' };
        }).catch(() => { }));
        return;
      }
      const lg = isBB(m) ? 'nba' : m.lg, t0 = new Date(m.d).getTime();
      (want[lg] = want[lg] || new Set()).add(ymd(t0)).add(ymd(t0 - 6 * 3600e3));
    });
    Object.keys(want).forEach(lg => want[lg].forEach(day => {
      const path = lg === 'nba' ? 'basketball/nba' : 'soccer/' + lg;
      jobs.push(fetch(`https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${day}&limit=200`).then(r => r.json()).then(d => {
        (d.events || []).forEach(e => {
          const st = e.status && e.status.type;
          if (!st || st.state === 'pre' || /POSTPON|CANCEL|ABANDON|SUSPEND|DELAY/.test(st.name || '')) return;
          const c = e.competitions[0].competitors, h = c.find(x => x.homeAway === 'home'), a = c.find(x => x.homeAway === 'away');
          const id = (lg === 'nba' ? 'b' : '') + e.id;
          LIVE[id] = { s: st.state === 'post' ? 'post' : 'in', hs: +h.score || 0, as: +a.score || 0,
            c: st.state === 'post' ? '' : /HALFTIME/.test(st.name) ? t('ht') : (lg === 'nba' ? st.shortDetail : e.status.displayClock) || '',
            fin: st.name === 'STATUS_FULL_TIME' || st.name === 'STATUS_FINAL' };
        });
      }).catch(() => { }));
    }));
    await Promise.all(jobs);
    polling = false;
    liveChanged();
  }
  function liveChanged() {
    let fin = false;
    Object.keys(LIVE).forEach(id => {
      const l = LIVE[id];
      if (l.s === 'post' && l.fin && !RES[id]) { RES[id] = { id, hs: l.hs, as: l.as, live: 1 }; fin = true; }
    });
    if (fin) {
      settle(); renderChrome();
      const h = location.hash || '#/', typing = document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
      if (!typing && /^#\/(mollamyrat|sonuclar|kuponlarim|profil)/.test(h)) { const y = scrollY; render(); scrollTo(0, y); return; }
    }
    paintLive();
  }

  // ---------- yonlendirme ----------
  let lastRoute = null;
  function render() {
    const h = location.hash || '#/';
    const mm = h.match(/^#\/mac\/(\w+)/);
    let html, title;
    if (mm) { html = viewMatch(mm[1]); const m = MATCH[mm[1]]; title = m ? tn(m.h) + ' – ' + tn(m.a) : t('bulletin'); }
    else if (h.startsWith('#/analiz')) { html = viewAnalysis(); title = t('analysis'); }
    else if (h.startsWith('#/basketbol')) { html = viewBasketball(); title = t('basketball'); }
    else if (h.startsWith('#/puan')) { html = viewTables(); title = t('tables'); }
    else if (h.startsWith('#/sonuclar')) { html = viewResults(); title = t('results'); }
    else if (h.startsWith('#/kuponlarim')) { html = viewCoupons(); title = t('mycoupons'); }
    else if (h.startsWith('#/kurallar')) { html = viewRules(); title = t('rules'); }
    else if (h.startsWith('#/mollamyrat')) { html = viewMolla(); title = t('tipc_title'); }
    else if (h.startsWith('#/profil')) { html = viewProfile(); title = t('profile'); }
    else { html = viewBulletin(); title = t('bulletin'); }
    $('main').innerHTML = html;
    document.title = title + ' — Ahal365';
    renderChrome(); renderSide(); renderSlip(); syncStrips(); paintLive();
    if (h !== lastRoute) { window.scrollTo(0, 0); lastRoute = h; }
  }
  let toastT;
  function toast(msg) { const el = $('toast'); el.textContent = msg; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 2600); }

  // ---------- olaylar ----------
  document.addEventListener('click', e => {
    const back = e.target.closest('[data-back]');
    if (back && navDepth > 0) { e.preventDefault(); return history.back(); }
    const b = e.target.closest('button'); if (!b) return;
    const d = b.dataset;
    if (d.m && d.k) return toggleSel(d.m, d.k);
    if (d.scroll) { const c = b.parentNode.querySelector('.chips'); return c.scrollBy({ left: +d.scroll * c.clientWidth * .7, behavior: 'smooth' }); }
    if (d.lg) { flt.lg = flt.lg === d.lg ? 'all' : d.lg; flt.alim = 48; return render(); }
    if (d.day) { flt.day = d.day; flt.q = ''; flt.alim = 48; return render(); }
    if (d.rday) { flt.rday = d.rday; return render(); }
    if (d.dtab) { dtab = d.dtab; return render(); }
    if (d.ttab) { ttab = d.ttab; return render(); }
    if (d.rm) return toggleSel(d.rm, (slip.find(s => s.m === d.rm) || {}).k);
    if (d.q) { stake = +d.q; LS.set('stake', stake); const i = $('stake'); if (i) i.value = stake; slipErr = ''; $('s-err').textContent = ''; return updWin(); }
    if (d.act === 'play') return play();
    if (d.act === 'amore') { flt.alim += 48; const y = scrollY; render(); scrollTo(0, y); return; }
    if (d.act === 'lvall') { flt.lvall = !flt.lvall; return paintLive(); }
    if (d.act === 'tipadd') {
      slip = MOLLA.coupons[0].picks.filter(pkLive).map(x => ({ m: x.id, k: x.k })); LS.set('slip', slip); slipErr = '';
      toast(t('tipc_added')); syncObs(); renderSlip();
      if (matchMedia('(max-width:860px)').matches) document.body.classList.add('slipopen');
      return;
    }
    if (d.act === 'clear') { slip = []; LS.set('slip', slip); document.body.classList.remove('slipopen'); syncObs(); return renderSlip(); }
    if (d.act === 'close') return document.body.classList.remove('slipopen');
    if (d.act === 'resetbal') { balance = START_BAL; saveUser(); return render(); }
    if (d.act === 'logout') { user = null; LS.set('user', null); loadUser(); return render(); }
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'stake') { stake = e.target.value; LS.set('stake', parseFloat(stake) || MIN_STAKE); updWin(); }
    if (e.target.id === 'q') { flt.q = e.target.value; $('blist').innerHTML = bulletinList(); const b = $('livebox'); if (b) b.innerHTML = flt.q.trim() ? '' : liveBox('fb'); }
  });
  document.addEventListener('submit', e => {
    const f = e.target.closest('form[data-form]'); if (!f) return;
    e.preventDefault();
    (f.dataset.form === 'reg' ? doRegister : doLogin)(f);
  });
  $('slipbar').addEventListener('click', () => document.body.classList.add('slipopen'));
  $('scrim').addEventListener('click', () => document.body.classList.remove('slipopen'));
  $('lang').addEventListener('change', e => { lang = e.target.value; LS.set('lang', lang); render(); });
  const stack = [location.hash || '#/'];
  window.addEventListener('hashchange', () => {
    const h = location.hash || '#/';
    if (stack.length > 1 && stack[stack.length - 2] === h) stack.pop(); else stack.push(h);
    navDepth = stack.length - 1;
    if (!/^#\/mac\//.test(location.hash)) dtab = 'pred';
    document.body.classList.remove('slipopen'); render();
  });
  window.addEventListener('resize', syncStrips);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') document.body.classList.remove('slipopen'); });

  cleanSlip(); settle(); render();
  pollLive(); setInterval(pollLive, 60e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pollLive(); });
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => { });
})();
