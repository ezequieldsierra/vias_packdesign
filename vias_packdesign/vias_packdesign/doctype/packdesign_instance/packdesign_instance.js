/* ==========================================================================
   PackDesign Instance – UI parámetros con Pop-out elegante
   ========================================================================== */

const MM_PER_IN = 25.4;

// === Boot-flag para evitar que el picker borre valores durante el arranque ===
let __PD_BOOTING = false;


/* ---------- Utilidades numéricas y de formato ---------- */
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

  // en pulgadas mostramos 3 decimales fijos
  if (uiUnit === 'in') return Number(v).toFixed(3);

  // en mm redondeamos a 2 decimales y quitamos ceros sobrantes
  const n = Number(v);
  if (!isFinite(n)) return '';
  const rounded = Math.round((n + Number.EPSILON) * 100) / 100;
  return rounded.toFixed(2).replace(/\.?0+$/, '');
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

/* ---------- Helpers genéricos ---------- */


function path_to_chain(pathStr){
  // "Diseños / Cajas Plegadizas / Tuck Lock" → ["Diseños","Cajas Plegadizas","Tuck Lock"]
  if (!pathStr) return [];
  return String(pathStr)
    .split('/')
    .map(s => s.replace(/\u00A0/g,' ').trim()) // NBSP→espacio y trim
    .filter(Boolean);
}


// Reconstruye el mapa desde la tabla hija 'values' (parameter/value)
function rebuildMapFromChild(frm){
  const rows = Array.isArray(frm.doc.values) ? frm.doc.values : [];
  const map = {};
  rows.forEach(r=>{
    const k = canonKey(r.parameter || r.label || '');
    const n = Number(r.value);
    if (k && Number.isFinite(n)) map[k] = n;
  });
  return map;
}

// Lee lo que está escrito en la UI (inputs .pd-input) → mm/num
function collectParamValuesFromUI(frm){
  const holder = frm.get_field('values_html');
  const wrap = holder?.$wrapper?.get(0);
  if (!wrap) return {};
  const unit = frm.doc._unit_ui || 'mm';
  const map = {};
  wrap.querySelectorAll('.pd-input').forEach(inp=>{
    const key   = inp.getAttribute('data-param');
    const isLen = inp.getAttribute('data-islen') === '1';
    if (!key) return;
    let raw = (inp.value || '').toString();
    raw = sanitizeNumber(raw, { allowNegative:false, maxDecimals: isLen && unit==='in' ? 3 : null });
    if (isLen) {
      map[key] = to_mm(raw, unit);
    } else {
      const n = Number(raw);
      if (Number.isFinite(n)) map[key] = n;
    }
  });
  return map;
}



function canonKey(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
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
  ['abs', 'ceil', 'floor', 'sqrt', 'pow', 'min', 'max', 'sin', 'cos', 'tan', 'atan2', 'PI', 'E']
    .forEach((n) => (ctx[n] = M[n]));
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

/* ---------- Indexado de parámetros desde plantilla ---------- */
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
    const linkName  = String(p?.parameter || '').trim();
    const nameKey   = canonKey(linkName);
    const labelKey  = canonKey(p?.label || '');
    const fieldKey  = canonKey(p?.fieldname || p?.fieldname_internal || '');
    const effective = linkName || String(p?.label || '').trim();
    const entry = {
      name: effective,
      label: String(p?.label || p?.parameter || '').trim(),
      unit: p?.unit,
      datatype: String(p?.datatype || '').toLowerCase(),
      fieldname: (p?.fieldname || p?.fieldname_internal || '') || '',
      aliases: [nameKey, labelKey, fieldKey].filter(Boolean),
    };
    entry.aliases.forEach((k) => (idx[k] = entry));
  });
  return idx;
}

/* ---------- Capas y estilos del preview ---------- */
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
    cut:          { stroke: '#000000', strokeWidth: 0.5, dasharray: ''     },
    crease:       { stroke: '#000000', strokeWidth: 0.3, dasharray: '2 2'  },
    bleed:        { stroke: '#FF0000', strokeWidth: 0.25, dasharray: ''    },
    registration: { stroke: '#00AAFF', strokeWidth: 0.2, dasharray: ''     },
    guide:        { stroke: '#666666', strokeWidth: 0.3, dasharray: ''     },
  };
  const base = defaults[lname] || defaults.cut;

  let stroke = base.stroke;
  let strokeWidth = base.strokeWidth;
  let dasharray = base.dasharray;

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

/* ---------- Sync hidden child table ---------- */
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
    frm.doc[fieldname] = (frm.doc[fieldname] || []).filter((r) =>
      keep.has(canonKey(r.parameter || ''))
    );
  }

  frm.refresh_field(fieldname);
}

/* ---------- Texto no escalable en SVG ---------- */
function normalizeNonScalingText(rootSvg) {
  if (!rootSvg || !rootSvg.getCTM) return;
  const texts = rootSvg.querySelectorAll('text[data-noscale="1"]');
  texts.forEach((t) => {
    try {
      const ctm = t.getCTM();
      if (!ctm) return;
      const scale = Math.hypot(ctm.a, ctm.b) || 1;

      const origAttr = t.getAttribute('data-orig-fs');
      const base = origAttr ? parseFloat(origAttr) :
                  (parseFloat(t.getAttribute('font-size')) || 4);

      if (!origAttr) t.setAttribute('data-orig-fs', base);
      t.setAttribute('font-size', base / scale);
    } catch {}
  });
}


/* ---------- Recalcular derivados respetando overrides ---------- */
async function recomputeDerived(frm, tpl, hasFormulaDefault) {
  if (!frm.doc._pd_values) frm.doc._pd_values = {};
  if (!frm.doc._pd_overrides) frm.doc._pd_overrides = {};

  const params = (tpl.parameters || []).map((p) => ({
    key: getParamKey(p),
    unit: p.unit,
    def: p.default_value,
  }));

  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    const ctx = buildEvalCtx(frm.doc._pd_values);

    for (const p of params) {
      if (!hasFormulaDefault[p.key]) continue;
      if (frm.doc._pd_overrides[p.key]) continue;

      const def = p.def;
      if (def == null || def === '') continue;

      let val = typeof def === 'string' ? numOrExpr(def, ctx) : Number(def);
      if (!isFinite(val)) continue;

      // contexto opera en mm
      if (frm.doc._pd_values[p.key] !== val) {
        frm.doc._pd_values[p.key] = val;
        changed = true;
      }
    }
    if (!changed) break;
  }
}

/* ==========================================================================
   RENDER DE PARÁMETROS – admite destino en el form o en la ventana popup
   ========================================================================== */
async function renderParamsUI(frm, targetDoc /* optional */) {
  // Elegimos contenedor según destino
  let wrap;
  if (targetDoc) {
    const el = targetDoc.getElementById('pd-floating-root');
    if (!el) return;
    wrap = el;
  } else {
    const holder = frm.get_field('values_html');
    if (!holder) return;
    wrap = holder.$wrapper.get(0);
  }

  if (!frm.doc._pd_overrides) frm.doc._pd_overrides = {};

  if (!frm.doc.template) {
    wrap.innerHTML = `<div style="color:#999"></div>`;
    return;
  }

  const tpl = await frappe.db.get_doc('PackDesign Template', frm.doc.template);

  // Defaults que son fórmulas
  const hasFormulaDefault = Object.create(null);
  (tpl.parameters || []).forEach((p) => {
    const key = getParamKey(p);
    const def = p.default_value;
    const isFormula = typeof def === 'string' && /[A-Za-z_]/.test(def);
    if (isFormula) hasFormulaDefault[key] = true;
  });

  const paramIdx = buildParamIndex(tpl);
  if (!frm.doc._unit_ui) frm.doc._unit_ui = 'mm';

  // limpiar valores viejos si keys no existen ya
  if (
    frm.doc._pd_values &&
    Object.keys(frm.doc._pd_values).some((k) => !paramIdx[canonKey(k)])
  ) {
    frm.doc._pd_values = {};
  }

  const current_mm = frm.doc._pd_values || {};

  // 1) arrastrar desde child table (si faltan)
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
    if (current_mm[kHit] !== undefined && current_mm[kHit] !== null && current_mm[kHit] !== '')
      return;
    const n = Number(v.value);
    if (Number.isFinite(n)) current_mm[kHit] = n;
  });

  // 2) completar faltantes con defaults (multipass; soporta fórmulas)
  const params = (tpl.parameters || []).map((p) => ({
    key: getParamKey(p),
    unit: p.unit,
    dtype: String(p.datatype || '').toLowerCase(),
    def: p.default_value,
    label: getParamLabel(p),
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
        val = isFormula ? val : to_mm(val, base); // fórmula ya en mm
      }

      current_mm[p.key] = val;
      changed = true;
    }
    if (!changed) break;
  }

  frm.doc._pd_values = current_mm;

  // 2.5) derivados (respetando overrides)
  await recomputeDerived(frm, tpl, hasFormulaDefault);

  // 3) sync child table visible a NAME
  // syncHiddenValuesTable(frm, frm.doc._pd_values || {}, tpl, true);

  /* ---------- UI Header con Pop-out y radios ---------- */
  const headerHTML = `
    <div class="pd-header">
      <div class="pd-title">
        <span>Parámetros</span>
        <button type="button" id="pd_popout_btn" class="pd-btn">Pop-out</button>
      </div>
      <div class="pd-unit">
        <span>Unidad de entrada:</span>
        <label class="pd-radio">
          <input type="radio" name="pd_unit_ui" value="mm" />
          <span>mm</span>
        </label>
        <label class="pd-radio">
          <input type="radio" name="pd_unit_ui" value="in" />
          <span>in</span>
        </label>
      </div>
    </div>
  `;

  const uiUnit = frm.doc._unit_ui;

  function computeDefaultMM(p) {
    const ctx = buildEvalCtx(frm.doc._pd_values || {});
    let val = typeof p.def === 'string' ? numOrExpr(p.def, ctx) : Number(p.def);
    if (!isFinite(val)) return '';
    if (is_length_unit(p.unit)) {
      const base = normalize_length_unit(p.unit);
      const isFormula = typeof p.def === 'string' && /[A-Za-z_]/.test(p.def);
      val = isFormula ? val : to_mm(val, base);
    }
    return val;
  }

  const rowsHTML = params
    .map((p) => {
      const key = p.key;
      const isLen = is_length_unit(p.unit);
      const raw_mm = current_mm[key];
      const val_ui = isLen ? format_ui_len(raw_mm, uiUnit) : raw_mm ?? '';
      const dtype = p.dtype;
      const step =
        dtype === 'int' ? '1' : isLen ? (uiUnit === 'in' ? '0.001' : '0.01') : '0.01';
      const type = dtype === 'int' || dtype === 'float' || isLen ? 'number' : 'text';
      const unitBadge = isLen ? uiUnit : p.unit || '';
      const pattern =
        uiUnit === 'in' && isLen ? '[0-9]*[.]?[0-9]{0,3}' : '[0-9]*[.]?[0-9]*';
      const label = p.label;

      const hasDefault = p.def !== undefined && p.def !== null && String(p.def) !== '';
      const defaultBtn = hasDefault
        ? `
          <button type="button" class="pd-reset" data-param="${key}" title="Restablecer por defecto">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 4a8 8 0 1 1-7.47 10.66 1 1 0 1 1 1.9-.63A6 6 0 1 0 12 6h-1.6a1 1 0 0 1 0-2H12a1 1 0 0 1 1 1v2a1 1 0 1 1-2 0V4z" fill="currentColor"/>
            </svg>
          </button>
        `
        : '';

      return `
      <div class="pd-item">
        <div class="pd-top">
          <label class="pd-label">${frappe.utils.escape_html(label)}</label>
          ${defaultBtn}
        </div>

        <div class="pd-bottom">
          <input
            class="pd-input"
            data-param="${key}"
            data-islen="${isLen ? '1' : '0'}"
            type="${type}"
            step="${step}"
            value="${val_ui ?? ''}"
            inputmode="decimal"
            pattern="${pattern}"
          />
          <span class="pd-unit">${frappe.utils.escape_html(unitBadge)}</span>
        </div>
      </div>`;

    })
    .join('');

  /* ---------- HTML completo ---------- */
  wrap.innerHTML = `
    <style>
    /* Panel y cabecera más compactos */
    .pd-panel{border:1px solid #e6ecf5;border-radius:10px;background:#fff;font-size:12px}
    .pd-header{display:flex;align-items:center;gap:8px;padding:8px;border-bottom:1px solid #eef2fa}
    .pd-title{display:flex;align-items:center;gap:6px;font-weight:600;color:#0f172a}
    .pd-btn{appearance:none;border:1px solid #dbe3f2;background:#f7faff;padding:3px 7px;border-radius:7px;font-size:11px;cursor:pointer}
    .pd-btn:hover{background:#f0f6ff}

    /* Radios (derecha) */
    .pd-unitbar{margin-left:auto;display:flex;align-items:center;gap:6px;color:#334155}
    .pd-radio{display:inline-flex;align-items:center;gap:4px}

    /* Grid más apretado */
    .pd-grid{display:grid;grid-template-columns:repeat(10,minmax(0,1fr));gap:6px;padding:8px}

    /* Tarjeta del parámetro */
    .pd-item{
      position:relative;border:1px solid #e9eef8;border-radius:9px;background:#fff;padding:6px;
      display:flex;flex-direction:column;align-items:center;text-align:center;gap:4px
    }
    .pd-item:nth-child(odd){background:#f9fbff;border-color:#dfe8fb}
    .pd-item:nth-child(even){background:#fff;border-color:#e9eef8}
    .pd-item::before{content:"";position:absolute;inset:0 0 0 auto;width:2px;border-top-right-radius:9px;border-bottom-right-radius:9px;
                    background:linear-gradient(180deg,#7aa2ff,#94e0ff);opacity:.22}
    .pd-item:nth-child(even)::before{background:linear-gradient(180deg,#8fd2ff,#a6f7c5)}

    /* Filas arriba/abajo más bajas y alineadas */
    .pd-top{display:flex;align-items:center;justify-content:center;gap:4px;line-height:1}
    .pd-bottom{display:flex;align-items:center;justify-content:center;gap:4px;line-height:1}

    .pd-label{font-size:11px;color:#334155;font-weight:600;line-height:1;display:inline-flex;align-items:center}
    .pd-unitval{font-size:11px;color:#64748b;white-space:nowrap;line-height:1}

    /* Botón de reset alineado con el label (nudging óptico) */
    .pd-reset{
      appearance:none;border:none;background:transparent;padding:0;
      width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center;
      color:#5b7cff;opacity:.78;cursor:pointer;vertical-align:middle
    }
    .pd-reset:hover{opacity:1}
    .pd-reset:focus{outline:2px solid #cfe0ff;outline-offset:2px;border-radius:4px}
    .pd-reset svg{display:block;width:11px;height:11px;transform:translateY(-0.5px)}

    /* Inputs más bajos y angostos (ajusta solo esta variable) */
    :root{--pd-input-w:48px}

    .pd-input{
      flex:0 0 auto;width:var(--pd-input-w);min-width:var(--pd-input-w);max-width:calc(var(--pd-input-w) + 8px);
      padding:3px 6px;border:1px solid #d9e1ee;border-radius:6px;background:#fff;font-size:11px;height:24px;text-align:center;line-height:1
    }

    /* Oculta flechas numéricas */
    .pd-input[type=number]::-webkit-outer-spin-button,
    .pd-input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
    .pd-input[type=number]{-moz-appearance:textfield;appearance:textfield}

    /* Responsivo */
    @media (max-width:1280px){.pd-grid{grid-template-columns:repeat(8,minmax(0,1fr))}}
    @media (max-width:1024px){.pd-grid{grid-template-columns:repeat(6,minmax(0,1fr))}}
    @media (max-width:820px){.pd-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
    @media (max-width:640px){.pd-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media (max-width:420px){.pd-grid{grid-template-columns:repeat(1,minmax(0,1fr))}}
  </style>
  <div class="pd-panel">
    ${headerHTML}
    ${rowsHTML ? `<div class="pd-grid">${rowsHTML}</div>` : '<div style="color:#999;padding:10px">Esta plantilla no tiene parámetros.</div>'}
  </div>
  `;

  /* ---------- Estado inicial de radios (sin checked inline) ---------- */
  const radios = wrap.querySelectorAll('input[name="pd_unit_ui"]');
  radios.forEach((r) => (r.checked = r.value === frm.doc._unit_ui));

  /* ---------- Pop-out ---------- */
  const popBtn = wrap.querySelector('#pd_popout_btn');
  if (!targetDoc && popBtn) {
    popBtn.addEventListener('click', () => _pd_open_popup(frm));
  }

  /* ---------- Eventos de UI ---------- */

  // Cambio de unidad
  wrap.querySelectorAll('input[name="pd_unit_ui"]').forEach((rad) => {
    rad.addEventListener('change', async () => {
      const newUnit = rad.value;
      if (frm.doc._unit_ui !== newUnit) {
        frm.doc._unit_ui = newUnit;
        // re-render en el mismo destino (main o popup)
        await renderParamsUI(frm, targetDoc || null);
        renderFromGeometrySpec(frm, frm.doc._pd_values);
      }
    });
  });

  // Bloquear e/E/+ en number
  wrap.querySelectorAll('.pd-input').forEach((inp) => {
    inp.addEventListener('keydown', (ev) => {
      const bad = ['e', 'E', '+'];
      if (bad.includes(ev.key)) ev.preventDefault();
    });
  });

  // Input handler
  wrap.querySelectorAll('.pd-input').forEach((inp) => {
    inp.addEventListener(
      'input',
      frappe.utils.debounce(async () => {
        const key   = inp.getAttribute('data-param');
        const isLen = inp.getAttribute('data-islen') === '1';
        const raw   = inp.value;

        let cleaned = sanitizeNumber(raw, {
          allowNegative: false,
          maxDecimals: isLen && (frm.doc._unit_ui === 'in') ? 3 : null,
        });
        if (isLen && frm.doc._unit_ui === 'in') cleaned = clamp_in_decimals(cleaned);
        if (cleaned !== raw) inp.value = cleaned;

        if (!frm.doc._pd_values) frm.doc._pd_values = {};

        if (isLen) {
          frm.doc._pd_values[key] = to_mm(cleaned, frm.doc._unit_ui);
        } else {
          const n = parseFloat(cleaned);
          frm.doc._pd_values[key] = !isNaN(n) && cleaned !== '' ? n : '';
        }

        // marcar override
        if (!frm.doc._pd_overrides) frm.doc._pd_overrides = {};
        frm.doc._pd_overrides[key] = true;

        const tpl2 = await frappe.db.get_doc('PackDesign Template', frm.doc.template);
        const hasFormulaDefault2 = Object.create(null);
        (tpl2.parameters || []).forEach((p) => {
          const k2  = getParamKey(p);
          const def = p.default_value;
          if (typeof def === 'string' && /[A-Za-z_]/.test(def)) hasFormulaDefault2[k2] = true;
        });

        await recomputeDerived(frm, tpl2, hasFormulaDefault2);
        syncHiddenValuesTable(frm, frm.doc._pd_values, tpl2);
        renderFromGeometrySpec(frm, frm.doc._pd_values);

        // refrescar los no overrideados sin re-render completo
        wrap.querySelectorAll('.pd-input').forEach((el) => {
          const k   = el.getAttribute('data-param');
          const isL = el.getAttribute('data-islen') === '1';
          if (frm.doc._pd_overrides[k]) return;
          const vmm = frm.doc._pd_values[k];
          el.value  = isL ? format_ui_len(vmm, frm.doc._unit_ui) : (vmm ?? '');
        });
      }, 80)
    );
  });

  // Normalizar mm (2 dec) al blur
  wrap.querySelectorAll('.pd-input').forEach((inp) => {
    inp.addEventListener('blur', () => {
      const isLen = inp.getAttribute('data-islen') === '1';
      if (!isLen || frm.doc._unit_ui !== 'mm') return;
      const raw = (inp.value || '').replace(',', '.');
      const n   = parseFloat(raw);
      if (isNaN(n)) return;
      const rounded = Math.round((n + Number.EPSILON) * 100) / 100;
      const shown   = rounded.toFixed(2).replace(/\.?0+$/, '');
      if (inp.value !== shown) {
        inp.value = shown;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  });

  // Botón “Default”
  wrap.querySelectorAll('.pd-reset').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const key = btn.getAttribute('data-param');
      const p   = params.find((x) => x.key === key);
      if (!p) return;

      const defMM = computeDefaultMM(p);
      if (defMM === '') return;

      frm.doc._pd_values[key] = defMM;
      if (frm.doc._pd_overrides) delete frm.doc._pd_overrides[key];

      const el = wrap.querySelector(`.pd-input[data-param="${key}"]`);
      if (el) {
        const isLen = el.getAttribute('data-islen') === '1';
        el.value = isLen ? format_ui_len(defMM, frm.doc._unit_ui) : (defMM ?? '');
      }

      const tpl2 = await frappe.db.get_doc('PackDesign Template', frm.doc.template);
      const hasFormulaDefault2 = Object.create(null);
      (tpl2.parameters || []).forEach((pp) => {
        const k2  = getParamKey(pp);
        const def = pp.default_value;
        if (typeof def === 'string' && /[A-Za-z_]/.test(def)) hasFormulaDefault2[k2] = true;
      });

      await recomputeDerived(frm, tpl2, hasFormulaDefault2);
      syncHiddenValuesTable(frm, frm.doc._pd_values, tpl2);
      renderFromGeometrySpec(frm, frm.doc._pd_values);

      wrap.querySelectorAll('.pd-input').forEach((el2) => {
        const k   = el2.getAttribute('data-param');
        const isL = el2.getAttribute('data-islen') === '1';
        if (frm.doc._pd_overrides && frm.doc._pd_overrides[k]) return;
        const vmm = frm.doc._pd_values[k];
        el2.value = isL ? format_ui_len(vmm, frm.doc._unit_ui) : (vmm ?? '');
      });
    });
  });
}

/* ==========================================================================
   PREVIEW desde Geometry Spec (igual que tenías)
   ========================================================================== */
async function renderFromGeometrySpec(frm, overrideValues = null) {
  const f = frm.get_field('preview_html');
  if (!f) return;

  if (!frm.doc.template) {
    f.$wrapper[0].innerHTML = '<div style="color:#999"></div>';
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
    f.$wrapper[0].innerHTML = `
      <div style="padding:8px;border:1px solid #ffd1d1;background:#fff3f3;border-radius:6px;color:#a40000">
        <b>Geometry Spec no es JSON válido.</b>
        <div style="margin-top:4px;font-family:monospace">
          ${frappe.utils.escape_html(String(e?.message || e))}
        </div>
      </div>`;
    return;
  }

  // --- preparar ctx de valores ---
  let values = {};
  const tplIdx = buildParamIndex(tpl);

  if (overrideValues && Object.keys(overrideValues).length) {
    const expanded = Object.create(null);
    for (const [k, v] of Object.entries(overrideValues)) {
      const hit = tplIdx[canonKey(k)];
      if (hit) {
        hit.aliases.forEach((a) => (expanded[a] = v));
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
      hit.aliases.forEach((a) => (values[a] = n));
      if (hit.fieldname) values[canonKey(hit.fieldname)] = n;
    });
  }

  const ctx = buildEvalCtx(values);
  ctx.unit_ui = frm.doc._unit_ui || 'mm';
  ctx.unit    = () => ctx.unit_ui;
  ctx.ui      = (val_mm, dec = 2) => {
    const x = parseFloat(val_mm);
    if (isNaN(x)) return '';
    const out = ctx.unit_ui === 'in' ? x / 25.4 : x;
    return Number(out).toFixed(dec);
  };

  // vars evaluadas multipass
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

  // bbox helpers
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

  // build shapes
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
        const r  = numOrExpr(s.r  || 0, env);
        pushBBoxCircle(cx, cy, r);
        emit(`<g data-layer="${layer}"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" ${strokeAttrs(st)} /></g>`);
        break;
      }
      case 'rect': {
        const x  = numOrExpr(s.x  || 0, env);
        const y  = numOrExpr(s.y  || 0, env);
        const w  = numOrExpr(s.w  || 0, env);
        const h  = numOrExpr(s.h  || 0, env);
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
        const markers = s.dim || s.marker === 'dim'
          ? ` marker-start="url(#pd_dim_arrow_start)" marker-end="url(#pd_dim_arrow_end)"`
          : '';
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

      case 'arc': {
        // arco por extremos + radio (un sólo cuadrante típico de solapa)
        const x1 = numOrExpr(s.x1 || 0, env);
        const y1 = numOrExpr(s.y1 || 0, env);
        const x2 = numOrExpr(s.x2 || 0, env);
        const y2 = numOrExpr(s.y2 || 0, env);
        const r  = Math.max(0.001, numOrExpr(s.r || s.radius || 0, env)); // clamp si r=0
        const laf = s.large ? 1 : 0;      // large-arc-flag  (0: arco corto)
        const sf  = s.sweep ? 1 : 0;      // sweep-flag      (1: sentido horario)
        pushBBoxLine(x1, y1, x2, y2);
        pushBBoxCircle((x1+x2)/2, (y1+y2)/2, r); // bounding aprox
        emit(`<g data-layer="${layer}"><path d="M ${x1} ${y1} A ${r} ${r} 0 ${laf} ${sf} ${x2} ${y2}" fill="none" ${strokeAttrs(st)} /></g>`);
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
        const x  = numOrExpr(s.x || 0, env);
        const y  = numOrExpr(s.y || 0, env);
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
        const anchor    = s.anchor   || 'start';
        const baseline  = s.baseline || 'alphabetic';
        const rot       = numOrExpr(s.rotate ?? s.rotation ?? s.angle ?? 0, env);
        const transform = isFinite(rot) && rot !== 0 ? ` transform="rotate(${rot} ${x} ${y})"` : '';
        emit(`<g data-layer="${layer}"><text data-noscale="1" x="${x}" y="${y}" font-size="${fs}" text-anchor="${anchor}" dominant-baseline="${baseline}" fill="${st.stroke}" stroke="none"${transform}>${frappe.utils.escape_html(content)}</text></g>`);
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
          const varname = m[1], from = parseInt(m[2], 10), to = parseInt(m[3], 10);
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
    w:    bbox.maxx - bbox.minx + margin * 2,
    h:    bbox.maxy - bbox.miny + margin * 2,
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
    <svg xmlns="http://www.w3.org/2000/svg"
         viewBox="${vb.minx} ${vb.miny} ${vb.w} ${vb.h}"
         width="100%" preserveAspectRatio="xMidYMid meet" style="height:auto;display:block">
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

/* ==========================================================================
   POP-OUT elegante (mueve la tabla fuera del form y la regresa)
   ========================================================================== */

function _pd_resize_popup_to_content(win) {
  try {
    const root = win.document.getElementById('pd-floating-root');
    if (!root) return;

    const pad = 24; // margen extra
    const rect = root.getBoundingClientRect();
    const w = Math.min(Math.max(520, Math.ceil(rect.width)  + pad), Math.max(600, window.screen.availWidth  - 40));
    const h = Math.min(Math.max(320, Math.ceil(rect.height) + pad + 48), Math.max(400, window.screen.availHeight - 80));
    win.resizeTo(w, h);

    const left = Math.max(0, (window.screen.availWidth  - w) / 2);
    const top  = Math.max(0, (window.screen.availHeight - h) / 3);
    win.moveTo(left, top);
  } catch {}
}

function _pd_set_main_placeholder(frm) {
  const holder = frm.get_field('values_html');
  if (!holder) return;
  const wrap = holder.$wrapper.get(0);
  wrap.innerHTML = `
    <div class="pd-panel" style="border:1px dashed #cbd5e1;border-radius:10px;padding:12px;background:#fbfdff">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="font-weight:600;color:#334155">Parámetros abiertos en ventana</div>
        <div style="margin-left:auto">
          <button type="button" id="pd_return_here"
                  style="appearance:none;border:1px solid #cfe0ff;background:#f4f8ff;
                         padding:6px 10px;border-radius:8px;font-size:12px;cursor:pointer;">
            Regresar aquí
          </button>
        </div>
      </div>
      <div style="font-size:12px;color:#64748b;margin-top:6px">
        Puedes seguir usando el documento. Haz clic en “Regresar aquí” para traer la tabla otra vez.
      </div>
    </div>
  `;
  const btn = wrap.querySelector('#pd_return_here');
  if (btn) btn.addEventListener('click', () => _pd_return_to_form(frm));
}

function _pd_clear_main_placeholder(frm) {
  const holder = frm.get_field('values_html');
  if (!holder) return;
  const wrap = holder.$wrapper.get(0);
  wrap.innerHTML = '';
}

function _pd_return_to_form(frm) {
  try { if (frm.__pd_popup && !frm.__pd_popup.closed) frm.__pd_popup.close(); } catch {}
  frm.__pd_popup = null;
  _pd_clear_main_placeholder(frm);
  renderParamsUI(frm).then(() => renderFromGeometrySpec(frm, frm.doc._pd_values || {}));
}

function _pd_close_popup(frm) {
  try { if (frm.__pd_popup && !frm.__pd_popup.closed) frm.__pd_popup.close(); } catch {}
  frm.__pd_popup = null;
  _pd_clear_main_placeholder(frm);
  renderParamsUI(frm).then(() => renderFromGeometrySpec(frm, frm.doc._pd_values || {}));
}

async function _pd_open_popup(frm) {
  // si ya está abierta, enfocar
  if (frm.__pd_popup && !frm.__pd_popup.closed) { frm.__pd_popup.focus(); return; }

  // poner placeholder en el form (la tabla “sale”)
  _pd_set_main_placeholder(frm);

  // abrir ventana (se ajustará al contenido luego)
  const win = window.open('', 'PDParamsPopup', 'popup=yes,width=640,height=420,resizable=yes,scrollbars=yes');
  if (!win) {
    frappe.msgprint('El navegador bloqueó la ventana emergente. Habilita popups para este sitio.');
    _pd_clear_main_placeholder(frm);
    await renderParamsUI(frm);
    return;
  }
  frm.__pd_popup = win;

  // UI del popup (estilo app)
  win.document.title = `Parámetros — ${frm.doc.name || ''}`;
  win.document.body.style.margin = '0';
  win.document.body.style.background = '#f6f8fb';
  win.document.body.innerHTML = `
    <div style="position:sticky;top:0;z-index:10;background:#ffffff;border-bottom:1px solid #e5eaf3;
                display:flex;align-items:center;gap:10px;padding:10px 12px">
      <button id="pd_back_btn"
              style="appearance:none;border:1px solid #dbe3f2;background:#f7faff;padding:6px 10px;border-radius:8px;cursor:pointer;font-size:12px">
        ← Regresar
      </button>
      <div style="margin-left:auto;color:#64748b;font-size:12px">${frappe.utils.escape_html(frm.doc.name || '')}</div>
    </div>
    <div id="pd-floating-root" style="padding:10px;font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif"></div>
  `;

  // renderizar parámetros dentro del popup
  await renderParamsUI(frm, win.document);

  // ajustar tamaño al contenido
  _pd_resize_popup_to_content(win);
  // volver a ajustar si cambian los radios/inputs (por si crece)
  const observer = new win.MutationObserver(() => _pd_resize_popup_to_content(win));
  observer.observe(win.document.getElementById('pd-floating-root'), { childList: true, subtree: true });

  // botón regresar
  win.document.getElementById('pd_back_btn')?.addEventListener('click', () => {
    if (window && typeof window._pd_return_to_form === 'function') {
      // no confíes en esto entre orígenes; aquí es mismo origen
    }
    _pd_return_to_form(frm);
  });

  // cerrar cuando se cierre el padre o cambie la ruta
  const onUnload = () => _pd_close_popup(frm);
  window.addEventListener('beforeunload', onUnload);

  const routeGuard = () => _pd_close_popup(frm);
  if (frappe.router && typeof frappe.router.on === 'function') {
    frm.__pd_router_unsub = frappe.router.on('change', routeGuard);
  } else {
    frm.__pd_hash_listener = () => routeGuard();
    window.addEventListener('hashchange', frm.__pd_hash_listener);
  }

  // si usuario cierra manualmente la ventana, limpiar y reponer en el form
  const timer = setInterval(() => {
    if (!frm.__pd_popup || frm.__pd_popup.closed) {
      clearInterval(timer);
      observer.disconnect();
      window.removeEventListener('beforeunload', onUnload);
      if (frm.__pd_router_unsub) { try { frm.__pd_router_unsub(); } catch {} }
      if (frm.__pd_hash_listener) window.removeEventListener('hashchange', frm.__pd_hash_listener);
      frm.__pd_router_unsub = null;
      frm.__pd_hash_listener = null;
      frm.__pd_popup = null;
      _pd_clear_main_placeholder(frm);
      renderParamsUI(frm).then(() => renderFromGeometrySpec(frm, frm.doc._pd_values || {}));
    }
  }, 600);
}

/* ==========================================================================
   Export helpers (sin cambios relevantes)
   ========================================================================== */
function _pd_get_current_svg_and_size(frm, { stripGuides = false } = {}) {
  const host = frm.get_field('preview_html')?.$wrapper?.[0];
  if (!host) throw new Error('No hay vista previa');

  const svgEl = host.querySelector('svg');
  if (!svgEl) throw new Error('No se encontró el SVG del preview');

  const vb = (svgEl.getAttribute('viewBox') || '').trim().split(/\s+/).map(Number);
  if (vb.length !== 4 || vb.some((v) => !isFinite(v))) throw new Error('El SVG no tiene viewBox válido');

  const width_mm  = vb[2];
  const height_mm = vb[3];
  const raw       = frm.doc.template || frm.doc.name || 'PackDesign';
  const basename  = String(raw).trim().replace(/[\\/:*?"<>|]+/g, '_');

  const clone = svgEl.cloneNode(true);

  if (stripGuides) {
    // Quitar cualquier nodo cuyo data-layer sea "guide" sin importar mayúsculas/minúsculas
    clone.querySelectorAll('[data-layer]').forEach((el) => {
      const v = String(el.getAttribute('data-layer') || '').trim().toLowerCase();
      if (v === 'guide') el.remove();
    });
    // Quitar marcadores de dimensión si quedaron huérfanos
    const stillHasGuides = clone.querySelector('[data-layer="Guide"],[data-layer="guide"]');
    if (!stillHasGuides) {
      const defs = clone.querySelector('defs');
      if (defs) {
        defs.querySelector('#pd_dim_arrow_start')?.remove();
        defs.querySelector('#pd_dim_arrow_end')?.remove();
      }
    }
  }

  const svg = new XMLSerializer().serializeToString(clone);
  return { svgEl, svg, width_mm, height_mm, basename };
}


function _pd_guides_checked(frm) {
  const host = frm.get_field('preview_html')?.$wrapper?.[0];
  const cb = host ? host.querySelector('#pd_toggle_guide') : null;
  return !!(cb && cb.checked);
}

async function exportPDF(frm) {
  try {
    frappe.dom.freeze('Generando PDF…');
    const stripGuides = !_pd_guides_checked(frm);
    const { svg, width_mm, height_mm, basename } =
      _pd_get_current_svg_and_size(frm, { stripGuides });
    const r = await frappe.call({
      method: 'vias_packdesign.api.packdesign_pdf.export_packdesign_instance_pdf',
      type: 'POST',
      args: { docname: frm.doc.name, svg, width_mm, height_mm, filename: basename + '.pdf', is_private: 0 },
      freeze: true,
      freeze_message: 'Convirtiendo SVG a PDF…',
    });
    const url = r?.message?.file_url;
    if (!url) throw new Error('No se recibió file_url');
    frappe.show_alert({ message: `PDF creado: <a target="_blank" href="${url}">${basename}.pdf</a>`, indicator: 'green' });
    window.open(url, '_blank');
  } catch (e) {
    console.error(e); frappe.msgprint('PDF: ' + (e.message || e));
  } finally {
    frappe.dom.unfreeze();
  }
}

async function exportSVG(frm) {
  try {
    frappe.dom.freeze('Guardando SVG…');
    const stripGuides = !_pd_guides_checked(frm);
    const { svg, width_mm, height_mm, basename } =
      _pd_get_current_svg_and_size(frm, { stripGuides });
    const r = await frappe.call({
      method: 'vias_packdesign.api.packdesign_pdf.export_packdesign_instance_svg',
      type: 'POST',
      args: { docname: frm.doc.name, svg, width_mm, height_mm, filename: basename + '.svg', is_private: 0 },
      freeze: true,
    });
    const url = r?.message?.file_url;
    if (!url) throw new Error('No se recibió file_url');
    frappe.show_alert({ message: `SVG creado: <a target="_blank" href="${url}">${basename}.svg</a>`, indicator: 'green' });
    window.open(url, '_blank');
  } catch (e) {
    console.error(e); frappe.msgprint('SVG: ' + (e.message || e));
  } finally {
    frappe.dom.unfreeze();
  }
}

async function exportDXF(frm) {
  try {
    frappe.dom.freeze('Generando DXF…');
    const stripGuides = !_pd_guides_checked(frm);
    const { svg, width_mm, height_mm, basename } =
      _pd_get_current_svg_and_size(frm, { stripGuides });
    const r = await frappe.call({
      method: 'vias_packdesign.api.packdesign_pdf.export_packdesign_instance_dxf',
      type: 'POST',
      args: { docname: frm.doc.name, svg, width_mm, height_mm, filename: basename + '.dxf', is_private: 0 },
      freeze: true,
      freeze_message: 'Convirtiendo SVG a DXF…',
    });
    const url = r?.message?.file_url;
    if (!url) throw new Error('No se recibió file_url');
    frappe.show_alert({ message: `DXF creado: <a target="_blank" href="${url}">${basename}.dxf</a>`, indicator: 'green' });
    window.open(url, '_blank');
  } catch (e) {
    console.error(e); frappe.msgprint('DXF: ' + (e.message || e));
  } finally {
    frappe.dom.unfreeze();
  }
}

/* ===================== HELPERS PICKER NUEVOS ===================== */
function _pd_get_picker_state() {
  const root = document.getElementById('pd-picker');
  if (!root) return { path: '', template: '' };
  const rows = Array.from(root.querySelectorAll('.pd-row > select'));
  const parts = rows.map(sel => sel && sel.value ? String(sel.value).trim() : '').filter(Boolean);
  const path = parts.join(' / ');
  const tplSel = root.querySelector('#pd-template-block select');
  const template = tplSel && tplSel.value ? String(tplSel.value).trim() : '';
  return { path, template };
}

function _pd_apply_picker_state_to_doc(frm) {
  const { path, template } = _pd_get_picker_state();

  // Si el picker no tiene nada seleccionado, NO toques el doc
  if (!path && !template) return;

  frm.doc.template_path = path || '';
  frm.doc.template = template || '';
  frm.refresh_field('template_path');
  frm.refresh_field('template');
}


function _pd_sync_picker_into_doc_if_present(frm){
  if (document.getElementById('pd-picker')) _pd_apply_picker_state_to_doc(frm);
}



/* ==========================================================================
   Hooks del DocType
   ========================================================================== */
frappe.ui.form.on('PackDesign Instance', {
 // dentro de frappe.ui.form.on('PackDesign Instance', { ... })
async refresh(frm) {
  // Guarda valores originales del servidor y entra en modo boot
  const _origTemplate = frm.doc.template || '';
  const _origPath     = frm.doc.template_path || '';
  __PD_BOOTING = true;

  if (!frm.doc._pd_values || Object.keys(frm.doc._pd_values).length === 0) {
    frm.doc._pd_values = rebuildMapFromChild(frm);
  }

  await renderParamsUI(frm);
  renderFromGeometrySpec(frm, frm.doc._pd_values || {});

  if (!frm.__pd_export_btns) {
    frm.__pd_export_btns = true;
    frm.add_custom_button('Exportar PDF', () => exportPDF(frm));
    frm.add_custom_button('Exportar SVG', () => exportSVG(frm));
    frm.add_custom_button('Exportar DXF', () => exportDXF(frm));
  }

  build_template_picker(frm);

  if (frm.doc.template) {
    // Hidrata el picker desde el doc (no escribe al doc en boot)
    await preload_template_path(frm);
  }

  // Salimos de boot: a partir de aquí el picker sí puede escribir
  __PD_BOOTING = false;

  // Reafirma lo que vino del server si por alguna carrera quedó vacío
  if (_origTemplate && !frm.doc.template) {
    frm.doc.template = _origTemplate;
    frm.refresh_field('template');
  }
  if (_origPath && !frm.doc.template_path) {
    frm.doc.template_path = _origPath;
    frm.refresh_field('template_path');
  }
},


  async template(frm) {
    // Cambiar template limpia parámetros pero NO toca template_path
    frm.doc._pd_values = {};
    await renderParamsUI(frm);
    renderFromGeometrySpec(frm, frm.doc._pd_values || {});
  },

  async before_save(frm) {
    // 1) Trae los parámetros que el usuario ve
    frm.doc._pd_values = collectParamValuesFromUI(frm);
    const map = frm.doc._pd_values || {};
    const tpl = frm.doc.template ? await frappe.db.get_doc('PackDesign Template', frm.doc.template) : null;
    syncHiddenValuesTable(frm, map, tpl, true);

    // 2) **FORZAR** que template y template_path sean EXACTAMENTE lo visible en el picker
    _pd_apply_picker_state_to_doc(frm);

    // 3) Cierra popup si estaba abierto
    if (frm.__pd_popup && !frm.__pd_popup.closed) frm.__pd_popup.close();
  },

  on_trash(frm){ if (frm.__pd_popup && !frm.__pd_popup.closed) frm.__pd_popup.close(); },
  on_hide(frm){ if (frm.__pd_popup && !frm.__pd_popup.closed) frm.__pd_popup.close(); }
});


let __pd_picker_ver = 0; // versión global de render (incrementa en cada build)

function build_template_picker(frm){
  const f = frm.get_field('template_picker_html');
  if (!f) return;
  const id = 'pd-picker';

  const html = `
    <style>
      #${id}{display:block}
      #${id} .pd-card{border:1px solid #e6ecf5;border-radius:12px;background:#fff;padding:12px}
      #${id} .pd-rows{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));align-items:start}
      #${id} .pd-block{display:flex;flex-direction:column;gap:6px}
      #${id} .pd-label{font-size:12px;color:#475569}
      #${id} select{appearance:none;border:1px solid #dbe3f2;border-radius:10px;background:#fff;height:38px;padding:0 12px;outline:none}
      #${id} select:focus{border-color:#94b5ff;box-shadow:0 0 0 3px rgba(59,130,246,.15)}
      #${id} .pd-path{font-size:12px;color:#475569;margin-top:8px}
      #${id} .pd-block.template{order:999}
    </style>
    <div id="${id}">
      <div class="pd-card">
        <div class="pd-rows"></div>
        <div class="pd-path"></div>
      </div>
    </div>
  `;
  f.$wrapper.html(html);

  const ver = ++__pd_picker_ver;
  // LOG
  console.log('[PD] build_picker ver=', ver, 'template=', frm.doc.template);
  init_picker(frm, id, ver);
}



async function init_picker(frm, rootId, ver){
  const root = document.getElementById(rootId);
  if (!root) return;
  const rows = root.querySelector('.pd-rows');
  if (!rows) return;
  rows.innerHTML = '';

  // Si ya hay algo guardado, NO retornes; renderízalo.
  const hasTemplate     = !!frm.doc.template;
  const hasTemplatePath = !!frm.doc.template_path;

  if (hasTemplate || hasTemplatePath){
    set_path_display(root, frm.doc.template_path || '');
    // Intenta hidratar desde el template (hoja real)
    try { await preload_template_path(frm); } catch {}
    // Plan B: si por algún motivo no se construyó nada, usa el path guardado
    if (!root.querySelector('.pd-row')) {
      const chain = path_to_chain(frm.doc.template_path || '');
      if (chain.length) await render_picker_from_chain(frm, chain);
    }
    return;
  }

  // Caso sin datos previos: siembra sólo el primer nivel.
  add_category_select(frm, rows, null, 0, ver);
  set_path_display(root, '');
}






function add_category_select(frm, rowsContainer, parent, level, ver){
  fetch_categories(parent).then(list=>{
    if (ver !== __pd_picker_ver) return;

    const block = document.createElement('div');
    block.className = 'pd-block pd-row';
    block.dataset.level = String(level);

    const label = document.createElement('div');
    label.className = 'pd-label';
    label.textContent = `Nivel ${level+1}`;

    const sel = document.createElement('select');

    // Placeholder real (no selecciona la primera opción)
    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = `Selecciona nivel ${level+1}`;
    opt0.selected = true;
    opt0.disabled = true;
    sel.appendChild(opt0);

    // Soporta elementos como string u objeto {name,is_group}
    list.forEach(item => {
      const name = (typeof item === 'string') ? item : (item && item.name) ? item.name : '';
      if (!name) return;
      const isGroup = (typeof item === 'object') && (
        item.is_group === 1 || item.is_group === '1' || item.is_group === true
      );

      const o = document.createElement('option');
      o.value = name;
      o.textContent = isGroup ? `▸ ${name}` : name;
      sel.appendChild(o);
    });

    sel.value = '';               // asegura vacío al cargar
    sel.selectedIndex = 0;

    sel.addEventListener('change', ()=> on_category_change(frm, rowsContainer, block, sel.value, level, ver));

    block.appendChild(label);
    block.appendChild(sel);
    rowsContainer.appendChild(block);
  });
}





function ensure_template_block(rowsContainer){
  let tpl = rowsContainer.querySelector('#pd-template-block');
  if (!tpl){
    tpl = document.createElement('div');
    tpl.className = 'pd-block template';
    tpl.id = 'pd-template-block';
    const lbl = document.createElement('div');
    lbl.className = 'pd-label';
    lbl.textContent = 'Template';
    const sel = document.createElement('select');
    const opt0 = document.createElement('option');
    opt0.value = ''; opt0.textContent = 'Selecciona template';
    sel.appendChild(opt0);
    tpl.appendChild(lbl);
    tpl.appendChild(sel);
    rowsContainer.appendChild(tpl);
  }
  return tpl;
}




function on_category_change(frm, rowsContainer, rowEl, name, level, ver){
  const root = rowsContainer.parentElement;

  prune_lower_levels(rowsContainer, level);
  clear_templates_block(root);

  // Sólo actualiza el texto visible del path (no el doc)
  set_path_display(root, build_cat_path(rowsContainer));

  if (!name){
    // Nada seleccionado en este nivel: no tocar el doc
    return;
  }

  Promise.all([ fetch_templates(name), fetch_categories(name) ]).then(([tplList, children])=>{
    if (ver !== __pd_picker_ver) return;

    const hasTemplatesHere = Array.isArray(tplList) && tplList.length > 0;
    const hasChildren      = Array.isArray(children) && children.length > 0;

    if (hasTemplatesHere) {
      fetch_and_render_templates(frm, name, root, ver);
      return;
    }

    if (hasChildren) {
      add_category_select(frm, rowsContainer, name, level+1, ver);
      // Actualiza sólo el texto visible del path
      set_path_display(root, build_cat_path(rowsContainer));
      return;
    }

    // Hoja sin hijos ni templates -> solo deja el path visible como está
    set_path_display(root, build_cat_path(rowsContainer));
  });
}






function moveTemplateToEnd(rowsContainer){
  const tpl = rowsContainer.querySelector('#pd-template-block');
  if (tpl){
    rowsContainer.appendChild(tpl); // re-append para dejarlo al final del DOM
    tpl.classList.add('template');   // asegura la regla CSS de order
  }
}


function fetch_categories(parent){
  return frappe.call({
    method: 'vias_packdesign.api.packdesign_picker.category_children',
    args: { parent: parent||null, txt: "", page_len: 200, start: 0 }
  }).then(r=> r.message||[]);
}

function fetch_templates(category){
  return frappe.call({
    method: 'vias_packdesign.api.packdesign_picker.templates_under',
    args: { category, txt: "", page_len: 500, start: 0 }
  }).then(r=> r.message||[]);
}

function fetch_and_render_templates(frm, category, root, ver){
  const rows = root.querySelector('.pd-rows');

  fetch_templates(category).then(list=>{
    if (ver !== __pd_picker_ver) return;

    if (!list || !list.length){
      clear_templates_block(root);
      // No tocar frm.doc.template ni template_path aquí
      set_path_display(root, build_cat_path(rows));
      return;
    }

    const tpl = document.createElement('div');
    tpl.className = 'pd-block template';
    tpl.id = 'pd-template-block';

    const lbl = document.createElement('div');
    lbl.className = 'pd-label';
    lbl.textContent = 'Template';

    const sel = document.createElement('select');

    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = 'Selecciona template';
    opt0.selected = true;
    opt0.disabled = true;
    sel.appendChild(opt0);

    list.forEach(n => sel.appendChild(new Option(n, n)));

    sel.onchange = ()=>{
      // Es el único momento (elección explícita) donde fijamos el template en el doc
      frm.doc.template = sel.value || '';
      frm.refresh_field('template');
      // Actualiza sólo el path visible; el template_path real se fija en before_save
      set_path_display(root, build_cat_path(rows));
    };

    clear_templates_block(root);
    tpl.appendChild(lbl);
    tpl.appendChild(sel);
    rows.appendChild(tpl);

    // Si ya viene un template del servidor, pré-selección sin disparar cambios destructivos
    if (frm.doc.template){
      let hit = Array.from(sel.options).find(o => o.value === frm.doc.template);
      if (!hit){
        hit = new Option(frm.doc.template, frm.doc.template, true, true);
        hit.dataset._temp = '1';
        sel.appendChild(hit);
      }
      hit.selected = true;
      sel.value = frm.doc.template;
    }

    set_path_display(root, build_cat_path(rows));
  });
}






function prune_lower_levels(rowsContainer, level){
  const rows = Array.from(rowsContainer.querySelectorAll('.pd-row'));
  rows.forEach(r=>{
    const lv = parseInt(r.dataset.level,10);
    if (lv>level) r.remove();
  });
}

function build_cat_path(rowsContainer){
  const rows = Array.from(rowsContainer.querySelectorAll('.pd-row'));
  const names = [];
  rows.forEach(r=>{
    const sel = r.querySelector('select');
    const v = sel && sel.value ? sel.value : '';
    if (v) names.push(v);
  });
  return names.join(' / ');
}

function set_path_from_rows(frm, rowsContainer){
  const rootEl = rowsContainer.parentElement;
  const path = build_cat_path(rowsContainer);
  set_path_display(rootEl, path); // sólo UI
}




function set_path_display(root, path){
  const el = root.querySelector('.pd-path');
  if (el) el.textContent = path||'';
}

function clear_templates_block(root){
  const el = root.querySelector('#pd-template-block');
  if (el) el.remove();  // eliminar por completo
}
function _canonCat(s){
  return String(s||'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'') // sin acentos
    .replace(/\u00A0/g,' ')  // NBSP → espacio
    .replace(/\s+/g,' ')     // colapsa espacios
    .trim()
    .toLowerCase();
}



async function render_picker_from_chain(frm, chain){
  const root = document.getElementById('pd-picker');
  if (!root) return;
  const rows = root.querySelector('.pd-rows');
  if (!rows) return;

  const ver = ++__pd_picker_ver;
  rows.innerHTML = '';

  // Cadena deseada (copiamos para no mutar arg)
  let wantChain = Array.isArray(chain) ? chain.slice() : [];

  let parent = null;
  let lastMatched = null;

  // Utilidad para obtener el nombre (string u objeto)
  const getName = (x) => (typeof x === 'string') ? x : (x && x.name) ? x.name : '';

  // Cargamos Nivel 1 del server
  const listLvl1 = await fetch_categories(parent);
  if (ver !== __pd_picker_ver) return;

  // --- (1) Strip de la RAÍZ que no exista en nivel 1 (acepta strings/objetos) ---
  if (Array.isArray(listLvl1) && listLvl1.length){
    const lvl1Set = new Set(listLvl1.map(x => _canonCat(getName(x))).filter(Boolean));
    while (wantChain.length && !lvl1Set.has(_canonCat(wantChain[0]))){
      // quita elementos del principio hasta que el primero sí exista en nivel 1
      wantChain.shift();
    }
  }

  // Creador de fila (nivel) que acepta strings/objetos
  const mkRow = (level, options)=> {
    const block = document.createElement('div');
    block.className = 'pd-block pd-row';
    block.dataset.level = String(level);

    const label = document.createElement('div');
    label.className = 'pd-label';
    label.textContent = `Nivel ${level+1}`;

    const sel = document.createElement('select');

    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = `Selecciona nivel ${level+1}`;
    opt0.selected = true;
    opt0.disabled = true;
    sel.appendChild(opt0);

    (options||[]).forEach(x=>{
      const name = getName(x);
      if (!name) return;
      const isGroup = (typeof x === 'object') && (
        x.is_group === 1 || x.is_group === '1' || x.is_group === true
      );
      sel.appendChild(new Option(isGroup ? `▸ ${name}` : name, name));
    });

    sel.addEventListener('change', ()=>{
      on_category_change(frm, rows, block, sel.value, level, ver);
    });

    block.appendChild(label);
    block.appendChild(sel);
    rows.appendChild(block);
    return sel;
  };

  if (!listLvl1 || !listLvl1.length){
    clear_templates_block(root);
    set_path_display(root, '');
    return;
  }

  const sel0 = mkRow(0, listLvl1);

  // --- (2) Match tolerante (acentos/espacios/case) en Nivel 1 ---
  const want0 = wantChain[0] || '';
  if (want0){
    const want0C = _canonCat(want0);
    const hit0 = Array.from(sel0.options).find(o =>
      o.value && _canonCat(o.value) === want0C
    );
    if (hit0){
      hit0.selected = true;
      sel0.value = hit0.value;
      // des-selecciona el placeholder explícitamente (Safari/Chromium)
      sel0.options[0].selected = false;
      parent = hit0.value;
      lastMatched = hit0.value;
    }
  }

  // --- (3) Descender niveles con el mismo match tolerante ---
  for (let i = 1; i < wantChain.length && lastMatched; i++){
    const list = await fetch_categories(parent);
    if (ver !== __pd_picker_ver) return;
    if (!list || !list.length) break;

    const sel = mkRow(i, list);
    const want = wantChain[i];
    const wantC = _canonCat(want);

    const hit = Array.from(sel.options).find(o =>
      o.value && _canonCat(o.value) === wantC
    );

    if (hit){
      hit.selected = true;
      sel.value = hit.value;
      sel.options[0].selected = false; // limpia placeholder
      parent = hit.value;
      lastMatched = hit.value;
    } else {
      break;
    }
  }

  // --- (4) Render de templates en la última categoría encontrada ---
  if (lastMatched){
    await fetch_and_render_templates(frm, lastMatched, root, ver);
  } else {
    clear_templates_block(root);
  }

  set_path_display(root, build_cat_path(rows));
}







function set_template_path(frm){
  // SOLO lo que se ve en el picker
  const root = document.getElementById('pd-picker');
  const rows = root ? root.querySelector('.pd-rows') : null;
  const path = rows ? build_cat_path(rows) : '';
  frm.set_value('template_path', path || '');
}



async function preload_template_path(frm){
  const root = document.getElementById('pd-picker');
  if (!root) return;

  // Si no hay template, intenta con el path guardado directamente
  if (!frm.doc.template){
    const chainByPath = path_to_chain(frm.doc.template_path || '');
    if (chainByPath.length){
      await render_picker_from_chain(frm, chainByPath);
    }
    return;
  }

  // 1) Datos del template → path + categoría hoja (si el backend lo da)
  let info = {};
  try {
    info = await frappe.call({
      method: 'vias_packdesign.api.packdesign_picker.template_path',
      args: { template_name: frm.doc.template }
    }).then(r=> r.message || {});
  } catch {}

  // 2) Intentar con la "leaf category" del backend
  const leafCat = info.category || null;
  if (leafCat){
    const chain = await build_category_chain(leafCat).catch(()=>[]);
    if (Array.isArray(chain) && chain.length){
      await render_picker_from_chain(frm, chain);
      return;
    }
  }

  // 3) Plan B: usar el template_path guardado si existe
  const chainByPath = path_to_chain(frm.doc.template_path || info.path || '');
  if (chainByPath.length){
    await render_picker_from_chain(frm, chainByPath);
  }
}






function build_category_chain(category){
  return frappe.call({
    method: 'frappe.client.get',
    args: { doctype: 'PackDesign Category', name: category }
  }).then(async r=>{
    const node = r.message||{};
    const path = await frappe.call({
      method: 'frappe.client.get_list',
      args: {
        doctype: 'PackDesign Category',
        fields: ['name'],
        filters: [['lft','<=', node.lft],['rgt','>=', node.rgt]],
        order_by: 'lft asc',
        limit_page_length: 500
      }
    }).then(x=> (x.message||[]).map(y=>y.name));
    return path;
  });
}
