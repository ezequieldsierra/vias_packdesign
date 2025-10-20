const MM_PER_IN = 25.4;

function to_mm(val, unit_ui) {
  const n = parseFloat(val);
  if (isNaN(n)) return 0;
  return unit_ui === 'in' ? n * MM_PER_IN : n;
}

function from_mm(val_mm, unit_ui) {
  const n = parseFloat(val_mm);
  if (isNaN(n)) return '';
  return unit_ui === 'in' ? n / MM_PER_IN : n;
}

function is_length_unit(u = '') {
  const s = String(u).trim().toLowerCase();
  return ['mm', 'millimeter', 'millimeters', 'in', 'inch', 'inches', '"', 'in.'].includes(s);
}

function normalize_length_unit(u = 'mm') {
  const s = String(u).trim().toLowerCase();
  if (['in', 'inch', 'inches', '"', 'in.'].includes(s)) return 'in';
  return 'mm';
}

function format_ui_len(val_mm, uiUnit) {
  if (val_mm === '' || val_mm === undefined || val_mm === null) return '';
  const v = from_mm(val_mm, uiUnit);
  return uiUnit === 'in' ? Number(v).toFixed(3) : v;
}

function clamp_in_decimals(str) {
  const m = String(str).match(/^(-?\d*)(?:\.(\d{0,3}))?/);
  if (!m) return '';
  return m[1] + (m[2] !== undefined ? '.' + m[2] : '');
}

function sanitizeNumber(str, { allowNegative = false, maxDecimals = null } = {}) {
  let s = String(str).replace(',', '.').replace(/[^0-9.\-]/g, '');
  const parts = s.split('.');
  if (parts.length > 2) s = parts[0] + '.' + parts.slice(1).join('');
  if (!allowNegative) s = s.replace(/-/g, '');
  else s = s.replace(/(?!^)-/g, '');
  if (maxDecimals != null && maxDecimals >= 0 && s.includes('.')) {
    const [i, d] = s.split('.');
    s = i + '.' + d.slice(0, maxDecimals);
  }
  if (s === '.' || s === '-' || s === '-.') return '';
  return s;
}

function canonKey(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_')
    .toLowerCase();
}

function setCtx(ctx, key, val) {
  const k = String(key);
  const num = typeof val === 'string' ? Number(val) : val;
  const v = typeof num === 'number' && isFinite(num) ? num : val;
  ctx[k] = v;
  ctx[canonKey(k)] = v;
}

function buildEvalCtx(seed = {}) {
  const ctx = Object.create(null);
  const M = Math;
  ['abs', 'ceil', 'floor', 'sqrt', 'pow', 'min', 'max', 'sin', 'cos', 'tan', 'atan2', 'PI', 'E'].forEach(
    (n) => (ctx[n] = M[n])
  );
  ctx.round = (x, n = 0) => {
    const xn = Number(x);
    const nn = Number(n) || 0;
    if (!isFinite(xn)) return 0;
    return Number(xn.toFixed(nn));
  };
  ctx.mm = 1;
  Object.keys(seed || {}).forEach((k) => setCtx(ctx, k, seed[k]));
  return ctx;
}

function numOrExpr(expr, env) {
  if (expr === null || expr === undefined) return 0;
  if (typeof expr === 'number') return expr;
  if (typeof expr !== 'string') {
    const n = parseFloat(expr);
    return isNaN(n) ? 0 : n;
  }
  const s = expr.trim();
  if (s === '') return 0;
  try {
    const fn = new Function('ctx', `with (ctx) { return (${s}); }`);
    const v = fn(env);
    return typeof v === 'number' && isFinite(v) ? +v : 0;
  } catch {
    return 0;
  }
}

function evalStr(str, env) {
  if (typeof str !== 'string') return String(str ?? '');
  return str.replace(/\{([^}]+)\}/g, (_, ex) => {
    const v = numOrExpr(ex, env);
    return isFinite(v) ? v : 0;
  });
}

function getParamKey(p) {
  const primary = p?.parameter || p?.label || p?.fieldname || p?.fieldname_internal || p?.name || '';
  return canonKey(primary);
}

function getParamLabel(p) {
  return String(p?.label || p?.parameter || p?.name || '').trim();
}

function buildParamIndex(tpl) {
  const idx = Object.create(null);
  (tpl.parameters || []).forEach((p) => {
    const linkName = String(p?.parameter || '').trim();
    const nameKey = canonKey(linkName);
    const labelKey = canonKey(p?.label || '');
    const fieldKey = canonKey(p?.fieldname || p?.fieldname_internal || '');
    const effectiveName = linkName || String(p?.label || '').trim();
    const entry = {
      name: effectiveName,
      label: String(p?.label || p?.parameter || '').trim(),
      unit: p?.unit,
      datatype: String(p?.datatype || '').toLowerCase(),
      fieldname: (p?.fieldname || p?.fieldname_internal || '') || '',
      aliases: [nameKey, labelKey, fieldKey].filter(Boolean)
    };
    entry.aliases.forEach((k) => {
      idx[k] = entry;
    });
  });
  return idx;
}

function layerVisible(tpl, layer) {
  const lname = String(layer || 'Cut').toLowerCase();
  const cmp = (tpl.components || []).find(
    (c) =>
      String(c.component_type || '').toLowerCase() === lname ||
      String(c.layer_name || '').toLowerCase() === lname
  );
  if (!cmp) return true;
  if (typeof cmp.visible === 'string') return cmp.visible === '1';
  return cmp.visible !== 0 && cmp.visible !== false;
}

function layerStyle(tpl, layer) {
  const lname = String(layer || 'Cut').toLowerCase();
  const cmp = (tpl.components || []).find(
    (c) =>
      String(c.component_type || '').toLowerCase() === lname ||
      String(c.layer_name || '').toLowerCase() === lname
  );
  const defaults = {
    cut: { stroke: '#000000', strokeWidth: 0.5, dasharray: '' },
    crease: { stroke: '#000000', strokeWidth: 0.3, dasharray: '2 2' },
    bleed: { stroke: '#FF0000', strokeWidth: 0.25, dasharray: '' },
    registration: { stroke: '#00AAFF', strokeWidth: 0.2, dasharray: '' },
    guide: { stroke: '#666666', strokeWidth: 0.3, dasharray: '' }
  };
  const base = defaults[lname] || defaults.cut;
  let stroke = base.stroke,
    strokeWidth = base.strokeWidth,
    dasharray = base.dasharray;
  if (cmp) {
    if (cmp.color) stroke = cmp.color;
    const lw = Number(cmp.line_width);
    if (!isNaN(lw) && lw > 0) strokeWidth = lw;
    if (cmp.dasharray) dasharray = cmp.dasharray;
  }
  return { stroke, strokeWidth, dasharray };
}

function strokeAttrs(st) {
  const dash = st.dasharray ? ` stroke-dasharray="${st.dasharray}"` : '';
  return `stroke="${st.stroke}" stroke-width="${st.strokeWidth}" vector-effect="non-scaling-stroke"${dash}`;
}

function syncHiddenValuesTable(frm, map, tpl, full = false) {
  const fieldname = 'values';
  if (!Array.isArray(frm.doc[fieldname])) frm.doc[fieldname] = [];
  const paramIdx = tpl ? buildParamIndex(tpl) : {};
  const byName = Object.create(null);
  const byLabel = Object.create(null);
  (frm.doc[fieldname] || []).forEach((r) => {
    const kParam = canonKey(r.parameter || '');
    const kLabel = canonKey(r.label || '');
    if (kParam) byName[kParam] = r;
    if (kLabel) byLabel[kLabel] = r;
  });
  if (full) frm.clear_table(fieldname);
  Object.keys(map || {}).forEach((k) => {
    const hit = paramIdx[canonKey(k)];
    if (!hit || !hit.name) return;
    const nameKey = canonKey(hit.name);
    let row = null;
    if (!full) row = byName[nameKey] || byLabel[canonKey(hit.label || '')] || null;
    if (!row) {
      row = frm.add_child(fieldname);
      row.parameter = hit.name;
      row.label = hit.label || '';
    } else {
      row.parameter = hit.name;
      if (!row.label) row.label = hit.label || '';
    }
    row.value = map[k];
  });
  if (full) {
    const keep = new Set(
      Object.keys(map || {})
        .map((k) => {
          const h = paramIdx[canonKey(k)];
          return h && h.name ? canonKey(h.name) : null;
        })
        .filter(Boolean)
    );
    frm.doc[fieldname] = (frm.doc[fieldname] || []).filter((r) => keep.has(canonKey(r.parameter || '')));
  }
  frm.refresh_field(fieldname);
}

function normalizeNonScalingText(rootSvg) {
  if (!rootSvg || !rootSvg.getCTM) return;
  const texts = rootSvg.querySelectorAll('text[data-noscale="1"]');
  texts.forEach((t) => {
    try {
      const ctm = t.getCTM();
      if (!ctm) return;
      const scale = Math.sqrt(ctm.a * ctm.a + ctm.b * ctm.b) || 1;
      const fs = parseFloat(t.getAttribute('font-size')) || 4;
      t.setAttribute('font-size', fs / scale);
    } catch (e) {}
  });
}

async function recomputeDerived(frm, tpl, hasFormulaDefault) {
  if (!frm.doc._pd_values) frm.doc._pd_values = {};
  const params = (tpl.parameters || []).map((p) => ({
    key: getParamKey(p),
    unit: p.unit,
    def: p.default_value
  }));
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    const ctx = buildEvalCtx(frm.doc._pd_values);
    for (const p of params) {
      if (!hasFormulaDefault[p.key]) continue;
      if (p.def == null || p.def === '') continue;
      let val = typeof p.def === 'string' ? numOrExpr(p.def, ctx) : Number(p.def);
      if (!isFinite(val)) continue;
      if (frm.doc._pd_values[p.key] !== val) {
        frm.doc._pd_values[p.key] = val;
        changed = true;
      }
    }
    if (!changed) break;
  }
}

async function renderParamsUI(frm) {
  const holder = frm.get_field('values_html');
  if (!holder) return;
  const wrap = holder.$wrapper.get(0);

  if (!frm.doc.template) {
    wrap.innerHTML = `<div style="color:#999">Selecciona una plantilla…</div>`;
    return;
  }

  const tpl = await frappe.db.get_doc('PackDesign Template', frm.doc.template);

  const hasFormulaDefault = Object.create(null);
  (tpl.parameters || []).forEach((p) => {
    const key = getParamKey(p);
    const def = p.default_value;
    const isFormula = typeof def === 'string' && /[A-Za-z_]/.test(def);
    if (isFormula) hasFormulaDefault[key] = true;
  });

  const paramIdx = buildParamIndex(tpl);

  if (!frm.doc._unit_ui) frm.doc._unit_ui = 'mm';

  if (frm.doc._pd_values && Object.keys(frm.doc._pd_values).some((k) => !paramIdx[canonKey(k)])) {
    frm.doc._pd_values = {};
  }

  const current_mm = frm.doc._pd_values || {};

  (frm.doc.values || []).forEach((v) => {
    let kHit = '';
    if (v.parameter) {
      const hit = paramIdx[canonKey(v.parameter)];
      if (hit && hit.name) kHit = canonKey(hit.name);
    }
    if (!kHit && v.label) {
      const hit = paramIdx[canonKey(v.label)];
      if (hit && hit.name) kHit = canonKey(hit.name);
    }
    if (!kHit) return;
    if (current_mm[kHit] !== undefined && current_mm[kHit] !== null && current_mm[kHit] !== '') return;
    const n = Number(v.value);
    if (Number.isFinite(n)) current_mm[kHit] = n;
  });

  const params = (tpl.parameters || []).map((p) => ({
    key: getParamKey(p),
    unit: p.unit,
    dtype: String(p.datatype || '').toLowerCase(),
    def: p.default_value
  }));

  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    const ctx = buildEvalCtx(current_mm);
    for (const p of params) {
      if (current_mm[p.key] !== undefined && current_mm[p.key] !== '') continue;
      if (p.def === undefined || p.def === null || p.def === '') continue;
      let val = typeof p.def === 'string' ? numOrExpr(p.def, ctx) : Number(p.def);
      if (!isFinite(val)) continue;
      if (is_length_unit(p.unit)) {
        const base = normalize_length_unit(p.unit);
        const isFormula = typeof p.def === 'string' && /[A-Za-z_]/.test(p.def);
        val = isFormula ? val : to_mm(val, base);
      }
      current_mm[p.key] = val;
      changed = true;
    }
    if (!changed) break;
  }

  frm.doc._pd_values = current_mm;

  await recomputeDerived(frm, tpl, hasFormulaDefault);

  syncHiddenValuesTable(frm, frm.doc._pd_values || {}, tpl, true);

  const unitToggle = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <div style="font-weight:600">Parámetros</div>
      <div style="margin-left:auto;font-size:12px">
        Unidad de entrada:
        <label style="margin-left:6px"><input type="radio" name="pd_unit_ui" value="mm" ${frm.doc._unit_ui === 'mm' ? 'checked' : ''}/> mm</label>
        <label style="margin-left:6px"><input type="radio" name="pd_unit_ui" value="in" ${frm.doc._unit_ui === 'in' ? 'checked' : ''}/> in</label>
      </div>
    </div>
  `;

  const uiUnit = frm.doc._unit_ui;

  const rows = (tpl.parameters || []).map((p) => {
    const key = getParamKey(p);
    const isLen = is_length_unit(p.unit);
    const raw_mm = current_mm[key];
    const val_ui = isLen ? format_ui_len(raw_mm, uiUnit) : raw_mm ?? '';
    const dtype = String(p.datatype || '').toLowerCase();
    const step = dtype === 'int' ? '1' : isLen ? (uiUnit === 'in' ? '0.001' : '0.01') : '0.01';
    const type = dtype === 'int' || dtype === 'float' || isLen ? 'number' : 'text';
    const unitBadge = isLen ? uiUnit : p.unit || '';
    const pattern = uiUnit === 'in' && isLen ? '[0-9]*[.]?[0-9]{0,3}' : '[0-9]*[.]?[0-9]*';
    const label = getParamLabel(p);
    const isDerived = !!hasFormulaDefault[key];

    return `
      <div class="pd-item">
        <div class="pd-inputwrap">
          <label class="pd-label">${frappe.utils.escape_html(label)}</label>
          <input
            class="pd-input"
            data-param="${key}"
            data-islen="${isLen ? '1' : '0'}"
            ${isDerived ? 'data-derived="1" readonly' : ''}
            type="${type}"
            step="${step}"
            value="${val_ui ?? ''}"
            inputmode="decimal"
            pattern="${pattern}"
          >
          <span class="pd-unit">${frappe.utils.escape_html(unitBadge)}</span>
        </div>
      </div>
    `;
  }).join('');

  wrap.innerHTML = `
    <style>
      /* Panel principal: blanco y tipografía compacta en todo el bloque */
      .pd-panel {
        border:1px solid #e6ecf5;
        border-radius:8px;
        padding:10px;
        background:#ffffff;     /* blanco */
        font-size:12px;         /* reduce textos generales (incluye toggle de unidades) */
      }

      /* 10 columnas por defecto */
      .pd-grid {
        display:grid;
        grid-template-columns:repeat(10, minmax(0,1fr));
        gap:8px;                /* un poco más compacto */
      }

      /* Zebra + acento lateral */
      .pd-item {
        position:relative;
        border:1px solid #e9eef8;
        border-radius:10px;
        background:#ffffff;
        padding:6px;            /* compacto */
      }
      .pd-item:nth-child(odd)  { background:#f9fbff; border-color:#dfe8fb; }
      .pd-item:nth-child(even) { background:#ffffff; border-color:#e9eef8; }
      .pd-item::before {
        content:"";
        position:absolute; inset:0 0 0 auto; width:3px;
        border-top-right-radius:10px; border-bottom-right-radius:10px;
        background:linear-gradient(180deg,#7aa2ff,#94e0ff); opacity:0.25;
      }
      .pd-item:nth-child(even)::before { background:linear-gradient(180deg,#8fd2ff,#a6f7c5); }

      /* Fila de cada parámetro: etiqueta al lado del input */
      .pd-inputwrap {
        display:flex; align-items:center; gap:6px;
      }

      /* Textos más pequeños */
      .pd-label { font-size:11px; color:#334155; font-weight:600; white-space:nowrap; }
      .pd-unit  { font-size:11px; color:#64748b; white-space:nowrap; }

      /* Inputs más pequeños (texto y padding) */
      .pd-input {
        flex:1 1 auto; min-width:0;
        padding:4px 6px;
        border:1px solid #d9e1ee; border-radius:6px;
        background:#fff;
        font-size:11px;         /* tamaño de texto del input reducido */
        height:28px;            /* compacta altura sin perder accesibilidad */
      }

      /* Breakpoints: solo reducimos columnas cuando realmente no caben 10 */
      @media (max-width:1280px){ .pd-grid{ grid-template-columns:repeat(8,minmax(0,1fr)); } }
      @media (max-width:1024px){ .pd-grid{ grid-template-columns:repeat(6,minmax(0,1fr)); } }
      @media (max-width:820px){  .pd-grid{ grid-template-columns:repeat(4,minmax(0,1fr)); } }
      @media (max-width:640px){  .pd-grid{ grid-template-columns:repeat(2,minmax(0,1fr)); } }
      @media (max-width:420px){  .pd-grid{ grid-template-columns:repeat(1,minmax(0,1fr)); } }
    </style>

    <div class="pd-panel">
      ${unitToggle}
      ${rows ? `<div class="pd-grid">${rows}</div>` : '<div style="color:#999">Esta plantilla no tiene parámetros.</div>'}
    </div>
  `;

  wrap.querySelectorAll('input[name="pd_unit_ui"]').forEach((rad) => {
    rad.addEventListener('change', async () => {
      const newUnit = rad.value;
      if (frm.doc._unit_ui !== newUnit) {
        frm.doc._unit_ui = newUnit;
        await renderParamsUI(frm);
        renderFromGeometrySpec(frm, frm.doc._pd_values);
      }
    });
  });

  wrap.querySelectorAll('.pd-input').forEach((inp) => {
    inp.addEventListener('keydown', (ev) => {
      const bad = ['e', 'E', '+'];
      if (bad.includes(ev.key)) ev.preventDefault();
    });
  });

  wrap.querySelectorAll('.pd-input').forEach((inp) => {
    inp.addEventListener(
      'input',
      frappe.utils.debounce(async () => {
        const key = inp.getAttribute('data-param');
        const isLen = inp.getAttribute('data-islen') === '1';
        const raw = inp.value;

        let cleaned = sanitizeNumber(raw, {
          allowNegative: false,
          maxDecimals: isLen && uiUnit === 'in' ? 3 : null
        });
        if (isLen && uiUnit === 'in') cleaned = clamp_in_decimals(cleaned);
        if (cleaned !== raw) inp.value = cleaned;

        if (!frm.doc._pd_values) frm.doc._pd_values = {};
        if (isLen) {
          frm.doc._pd_values[key] = to_mm(cleaned, uiUnit);
        } else {
          const n = parseFloat(cleaned);
          frm.doc._pd_values[key] = !isNaN(n) && cleaned !== '' ? n : '';
        }

        const tpl2 = await frappe.db.get_doc('PackDesign Template', frm.doc.template);
        const hasFormulaDefault2 = Object.create(null);
        (tpl2.parameters || []).forEach((p) => {
          const k2 = getParamKey(p);
          const def = p.default_value;
          if (typeof def === 'string' && /[A-Za-z_]/.test(def)) hasFormulaDefault2[k2] = true;
        });

        await recomputeDerived(frm, tpl2, hasFormulaDefault2);
        syncHiddenValuesTable(frm, frm.doc._pd_values, tpl2);
        renderFromGeometrySpec(frm, frm.doc._pd_values);

        wrap.querySelectorAll('.pd-input[data-derived="1"]').forEach((el) => {
          const k = el.getAttribute('data-param');
          const isLen2 = el.getAttribute('data-islen') === '1';
          const vmm = frm.doc._pd_values[k];
          el.value = isLen2 ? format_ui_len(vmm, uiUnit) : vmm ?? '';
        });
      }, 80)
    );
  });
}

async function renderFromGeometrySpec(frm, overrideValues = null) {
  const f = frm.get_field('preview_html');
  if (!f) return;

  if (!frm.doc.template) {
    f.$wrapper[0].innerHTML = '<div style="color:#999">Selecciona una plantilla…</div>';
    return;
  }

  const tpl = await frappe.db.get_doc('PackDesign Template', frm.doc.template);
  const spec_text = (tpl.geometry_spec || '').trim();

  if (!spec_text) {
    f.$wrapper[0].innerHTML = '<div style="color:#999">Esta plantilla no tiene Geometry Spec.</div>';
    return;
  }

  let spec;
  try {
    spec = JSON.parse(spec_text);
  } catch (e) {
    f.$wrapper[0].innerHTML = `<div style="padding:8px;border:1px solid #ffd1d1;background:#fff3f3;border-radius:6px;color:#a40000"><b>Geometry Spec no es JSON válido.</b><div style="margin-top:4px;font-family:monospace">${frappe.utils.escape_html(
      String(e?.message || e)
    )}</div></div>`;
    return;
  }

  let values = {};
  const tplIdx = buildParamIndex(tpl);

  if (overrideValues && Object.keys(overrideValues).length) {
    const expanded = Object.create(null);
    for (const [k, v] of Object.entries(overrideValues)) {
      const hit = tplIdx[canonKey(k)];
      if (hit) {
        hit.aliases.forEach((a) => {
          expanded[a] = v;
        });
        if (hit.fieldname) expanded[canonKey(hit.fieldname)] = v;
      }
      expanded[canonKey(k)] = v;
    }
    values = expanded;
  } else {
    (frm.doc.values || []).forEach((v) => {
      const kParam = canonKey(v.parameter || '');
      const kLabel = canonKey(v.label || '');
      const hit = tplIdx[kParam] || tplIdx[kLabel];
      const n = Number(v.value);
      if (!hit || !isFinite(n)) return;
      hit.aliases.forEach((a) => {
        values[a] = n;
      });
      if (hit.fieldname) values[canonKey(hit.fieldname)] = n;
    });
  }

  const ctx = buildEvalCtx(values);
  ctx.unit_ui = frm.doc._unit_ui || 'mm';
  ctx.unit = () => ctx.unit_ui;
  ctx.ui = (val_mm, dec = 2) => {
    const x = parseFloat(val_mm);
    if (isNaN(x)) return '';
    const out = ctx.unit_ui === 'in' ? x / 25.4 : x;
    return Number(out).toFixed(dec);
  };

  if (spec.vars && typeof spec.vars === 'object') {
    for (let pass = 0; pass < 8; pass++) {
      let changed = false;
      for (const [k, expr] of Object.entries(spec.vars)) {
        const v = numOrExpr(expr, ctx);
        if (Number.isFinite(v)) {
          setCtx(ctx, k, v);
          changed = true;
        }
      }
      if (!changed) break;
    }
  }

  const margin = numOrExpr(spec.canvas?.margin ?? 10, ctx);

  let bbox = { minx: +Infinity, miny: +Infinity, maxx: -Infinity, maxy: -Infinity };
  const pushBBoxCircle = (cx, cy, r) => {
    bbox.minx = Math.min(bbox.minx, cx - r);
    bbox.maxx = Math.max(bbox.maxx, cx + r);
    bbox.miny = Math.min(bbox.miny, cy - r);
    bbox.maxy = Math.max(bbox.maxy, cy + r);
  };
  const pushBBoxRect = (x, y, w, h) => {
    bbox.minx = Math.min(bbox.minx, x);
    bbox.maxx = Math.max(bbox.maxx, x + w);
    bbox.miny = Math.min(bbox.miny, y);
    bbox.maxy = Math.max(bbox.maxy, y + h);
  };
  const pushBBoxLine = (x1, y1, x2, y2) => {
    bbox.minx = Math.min(bbox.minx, x1, x2);
    bbox.maxx = Math.max(bbox.maxx, x1, x2);
    bbox.miny = Math.min(bbox.miny, y1, y2);
    bbox.maxy = Math.max(bbox.maxy, y1, y2);
  };

  const out = [];
  let emit = (el) => out.push(el);

  function drawShape(s, env) {
    const layer = s.layer || 'Cut';
    if (!layerVisible(tpl, layer)) return;
    const st = layerStyle(tpl, layer);

    switch ((s.type || '').toLowerCase()) {
      case 'circle': {
        const cx = numOrExpr(s.cx || 0, env);
        const cy = numOrExpr(s.cy || 0, env);
        const r = numOrExpr(s.r || 0, env);
        pushBBoxCircle(cx, cy, r);
        emit(`<g data-layer="${layer}"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" ${strokeAttrs(st)} /></g>`);
        break;
      }
      case 'rect': {
        const x = numOrExpr(s.x || 0, env);
        const y = numOrExpr(s.y || 0, env);
        const w = numOrExpr(s.w || 0, env);
        const h = numOrExpr(s.h || 0, env);
        const rx = numOrExpr(s.rx || 0, env);
        pushBBoxRect(x, y, w, h);
        emit(`<g data-layer="${layer}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="none" ${strokeAttrs(st)} /></g>`);
        break;
      }
      case 'line': {
        const x1 = numOrExpr(s.x1 || 0, env);
        const y1 = numOrExpr(s.y1 || 0, env);
        const x2 = numOrExpr(s.x2 || 0, env);
        const y2 = numOrExpr(s.y2 || 0, env);
        pushBBoxLine(x1, y1, x2, y2);
        const markers = s.dim || s.marker === 'dim' ? ` marker-start="url(#pd_dim_arrow_start)" marker-end="url(#pd_dim_arrow_end)"` : '';
        emit(`<g data-layer="${layer}"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${strokeAttrs(st)}${markers} /></g>`);
        break;
      }
      case 'polyline': {
        const pts = (s.points || [])
          .map((p) =>
            typeof p === 'string'
              ? evalStr(p, env)
              : Array.isArray(p)
              ? `${numOrExpr(p[0], env)} ${numOrExpr(p[1], env)}`
              : ''
          )
          .join(' ');
        emit(`<g data-layer="${layer}"><polyline points="${pts}" fill="none" ${strokeAttrs(st)} /></g>`);
        break;
      }
      case 'path': {
        const d = (s.d || []).map((cmd) => evalStr(cmd, env)).join(' ');
        let fill = 'none';
        if (s.fill === true || String(s.fill || '').toLowerCase() === 'solid') fill = st.stroke;
        else if (typeof s.fill === 'string' && s.fill.trim()) fill = s.fill.trim();
        emit(`<g data-layer="${layer}"><path d="${d}" fill="${fill}" ${strokeAttrs(st)} /></g>`);
        break;
      }
      case 'text': {
        const x = numOrExpr(s.x || 0, env);
        const y = numOrExpr(s.y || 0, env);
        const fs = numOrExpr(s.font_size || 4, env);
        const evalAny = (expr, env2) => {
          try {
            const fn = new Function('ctx', `with (ctx) { return (${expr}); }`);
            const v = fn(env2);
            return v == null ? '' : String(v);
          } catch {
            return '';
          }
        };
        const content =
          typeof s.content === 'string'
            ? s.content.replace(/\{([^}]+)\}/g, (_, ex) => evalAny(ex, env))
            : String(s.content ?? '');
        const anchor = s.anchor || 'start';
        const baseline = s.baseline || 'alphabetic';
        const rot = numOrExpr(s.rotate ?? s.rotation ?? s.angle ?? 0, env);
        const transformAttr = isFinite(rot) && rot !== 0 ? ` transform="rotate(${rot} ${x} ${y})"` : '';
        emit(
          `<g data-layer="${layer}"><text data-noscale="1" x="${x}" y="${y}" font-size="${fs}" text-anchor="${anchor}" dominant-baseline="${baseline}" fill="${st.stroke}" stroke="none"${transformAttr}>${frappe.utils.escape_html(
            content
          )}</text></g>`
        );
        break;
      }
      case 'group': {
        const t = s.transform
          ? s.transform.replace(/\{([^}]+)\}/g, (_, ex) => {
              const v = numOrExpr(ex, env);
              return isFinite(v) ? v : 0;
            })
          : '';
        const inner = [];
        const prevEmit = emit;
        emit = (el) => inner.push(el);
        (s.shapes || []).forEach((sh) => drawShape(sh, env));
        emit = prevEmit;
        out.push(`<g transform="${t}" data-layer="${layer}">${inner.join('\n')}</g>`);
        break;
      }
      case 'repeat': {
        const m = String(s.for || '').match(/^\s*([a-zA-Z_]\w*)\s*=\s*(\d+)\s*\.\.\s*(\d+)\s*$/);
        if (m) {
          const varname = m[1],
            from = parseInt(m[2], 10),
            to = parseInt(m[3], 10);
          for (let i = from; i <= to; i++) {
            const env2 = Object.assign(Object.create(null), env);
            env2[varname] = i;
            const t = s.offset
              ? s.offset.replace(/\{([^}]+)\}/g, (_, ex) => {
                  const v = numOrExpr(ex, env2);
                  return isFinite(v) ? v : 0;
                })
              : '';
            const inner = [];
            const prevEmit = emit;
            emit = (el) => inner.push(el);
            (s.shapes || []).forEach((sh) => drawShape(sh, env2));
            emit = prevEmit;
            out.push(`<g transform="translate(${t || '0 0'})" data-layer="${layer}">${inner.join('\n')}</g>`);
          }
        }
        break;
      }
    }
  }

  (spec.shapes || []).forEach((sh) => drawShape(sh, ctx));

  if (!isFinite(bbox.minx)) bbox = { minx: -50, miny: -50, maxx: 50, maxy: 50 };

  const vb = {
    minx: bbox.minx - margin,
    miny: bbox.miny - margin,
    w: bbox.maxx - bbox.minx + margin * 2,
    h: bbox.maxy - bbox.miny + margin * 2
  };

  const guideStyle = layerStyle(tpl, 'Guide');

  const defs = `
    <defs>
      <marker id="pd_dim_arrow_start" viewBox="-6 0 6 6" refX="-6" refY="3" markerWidth="6" markerHeight="6" orient="auto" markerUnits="strokeWidth">
        <path d="M -6 3 L 0 0 L 0 6 Z" fill="${guideStyle.stroke}" vector-effect="non-scaling-stroke"/>
      </marker>
      <marker id="pd_dim_arrow_end" viewBox="0 0 6 6" refX="6" refY="3" markerWidth="6" markerHeight="6" orient="auto" markerUnits="strokeWidth">
        <path d="M 6 3 L 0 0 L 0 6 Z" fill="${guideStyle.stroke}" vector-effect="non-scaling-stroke"/>
      </marker>
    </defs>
  `;

  const guideOn = layerVisible(tpl, 'Guide');

  const controls = `
    <div style="margin:6px 0 4px">
      <label style="font:12px/1.4 Inter,system-ui,sans-serif">
        <input type="checkbox" id="pd_toggle_guide" ${guideOn ? 'checked' : ''}>
        Mostrar dimensiones (Guide)
      </label>
    </div>
  `;

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.minx} ${vb.miny} ${vb.w} ${vb.h}" width="100%" preserveAspectRatio="xMidYMid meet" style="height:auto;display:block">
      ${defs}
      <rect x="${vb.minx}" y="${vb.miny}" width="${vb.w}" height="${vb.h}" fill="white" stroke="#e6ecf5" stroke-width="0.2"/>
      ${out.join('\n')}
    </svg>
  `;

  f.$wrapper[0].innerHTML = controls + svg;

  const svgEl = f.$wrapper[0].querySelector('svg');
  normalizeNonScalingText(svgEl);

  if (!guideOn) {
    f.$wrapper[0].querySelectorAll('g[data-layer="Guide"]').forEach((g) => (g.style.display = 'none'));
  }

  const cb = f.$wrapper[0].querySelector('#pd_toggle_guide');
  if (cb) {
    cb.addEventListener('change', (e) => {
      const on = e.target.checked;
      f.$wrapper[0].querySelectorAll('g[data-layer="Guide"]').forEach((g) => (g.style.display = on ? '' : 'none'));
      const svgEl2 = f.$wrapper[0].querySelector('svg');
      normalizeNonScalingText(svgEl2);
    });
  }
}

function _pd_get_current_svg_and_size(frm) {
  const host = frm.get_field('preview_html')?.$wrapper?.[0];
  if (!host) throw new Error('No hay vista previa');
  const svgEl = host.querySelector('svg');
  if (!svgEl) throw new Error('No se encontró el SVG del preview');
  const vb = (svgEl.getAttribute('viewBox') || '').trim().split(/\s+/).map(Number);
  if (vb.length !== 4 || vb.some((v) => !isFinite(v))) {
    throw new Error('El SVG no tiene viewBox válido');
  }
  const width_mm = vb[2];
  const height_mm = vb[3];
  const svg = new XMLSerializer().serializeToString(svgEl);
  const raw = frm.doc.template || frm.doc.name || 'PackDesign';
  const basename = String(raw).trim().replace(/[\\/:*?"<>|]+/g, '_');
  return { svgEl, svg, width_mm, height_mm, basename };
}

async function exportPDF(frm) {
  try {
    frappe.dom.freeze('Generando PDF…');
    const { svg, width_mm, height_mm, basename } = _pd_get_current_svg_and_size(frm);
    const r = await frappe.call({
      method: 'vias_packdesign.api.packdesign_pdf.export_packdesign_instance_pdf',
      type: 'POST',
      args: { docname: frm.doc.name, svg, width_mm, height_mm, filename: basename + '.pdf', is_private: 0 },
      freeze: true,
      freeze_message: 'Convirtiendo SVG a PDF…'
    });
    const url = r?.message?.file_url;
    if (!url) throw new Error('No se recibió file_url');
    frappe.show_alert({ message: `PDF creado: <a target="_blank" href="${url}">${basename}.pdf</a>`, indicator: 'green' });
    window.open(url, '_blank');
  } catch (e) {
    console.error(e);
    frappe.msgprint('PDF: ' + (e.message || e));
  } finally {
    frappe.dom.unfreeze();
  }
}

async function exportSVG(frm) {
  try {
    frappe.dom.freeze('Guardando SVG…');
    const { svg, width_mm, height_mm, basename } = _pd_get_current_svg_and_size(frm);
    const r = await frappe.call({
      method: 'vias_packdesign.api.packdesign_pdf.export_packdesign_instance_svg',
      type: 'POST',
      args: { docname: frm.doc.name, svg, width_mm, height_mm, filename: basename + '.svg', is_private: 0 },
      freeze: true
    });
    const url = r?.message?.file_url;
    if (!url) throw new Error('No se recibió file_url');
    frappe.show_alert({ message: `SVG creado: <a target="_blank" href="${url}">${basename}.svg</a>`, indicator: 'green' });
    window.open(url, '_blank');
  } catch (e) {
    console.error(e);
    frappe.msgprint('SVG: ' + (e.message || e));
  } finally {
    frappe.dom.unfreeze();
  }
}

async function exportDXF(frm) {
  try {
    frappe.dom.freeze('Generando DXF…');
    const { svg, width_mm, height_mm, basename } = _pd_get_current_svg_and_size(frm);
    const r = await frappe.call({
      method: 'vias_packdesign.api.packdesign_pdf.export_packdesign_instance_dxf',
      type: 'POST',
      args: { docname: frm.doc.name, svg, width_mm, height_mm, filename: basename + '.dxf', is_private: 0 },
      freeze: true,
      freeze_message: 'Convirtiendo SVG a DXF…'
    });
    const url = r?.message?.file_url;
    if (!url) throw new Error('No se recibió file_url');
    frappe.show_alert({ message: `DXF creado: <a target="_blank" href="${url}">${basename}.dxf</a>`, indicator: 'green' });
    window.open(url, '_blank');
  } catch (e) {
    console.error(e);
    frappe.msgprint('DXF: ' + (e.message || e));
  } finally {
    frappe.dom.unfreeze();
  }
}

frappe.ui.form.on('PackDesign Instance', {
  async refresh(frm) {
    await renderParamsUI(frm);
    renderFromGeometrySpec(frm, frm.doc._pd_values || {});
    if (!frm.__pd_export_btns) {
      frm.__pd_export_btns = true;
      frm.add_custom_button('Exportar PDF', () => exportPDF(frm));
      frm.add_custom_button('Exportar SVG', () => exportSVG(frm));
      frm.add_custom_button('Exportar DXF', () => exportDXF(frm));
    }
  },

  async template(frm) {
    frm.doc._pd_values = {};
    await renderParamsUI(frm);
    renderFromGeometrySpec(frm, {});
  },

  async before_save(frm) {
    const map = frm.doc._pd_values || {};
    const tpl = frm.doc.template ? await frappe.db.get_doc('PackDesign Template', frm.doc.template) : null;
    syncHiddenValuesTable(frm, map, tpl, true);
  }
});
