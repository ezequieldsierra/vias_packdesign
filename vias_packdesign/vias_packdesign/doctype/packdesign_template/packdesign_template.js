// PackDesign Template — Autocompleta metadatos desde PackDesign Parameter + orden sugerido de capas

frappe.ui.form.on('PackDesign Template Parameter', {
  async parameter(frm, cdt, cdn) {
    const row = frappe.get_doc(cdt, cdn);
    if (!row.parameter) return;
    const p = await frappe.db.get_doc('PackDesign Parameter', row.parameter);
    if (!p) return;

    // Copia metadatos solo si están vacíos en la fila
    if (!row.label) frappe.model.set_value(cdt, cdn, 'label', p.label);
    if (!row.value_type) frappe.model.set_value(cdt, cdn, 'value_type', p.datatype);
    if (!row.unit && p.unit) frappe.model.set_value(cdt, cdn, 'unit', p.unit);
    if (!row.default_value && p.default_value) frappe.model.set_value(cdt, cdn, 'default_value', p.default_value);
    if (!row.min_value && p.min_value != null) frappe.model.set_value(cdt, cdn, 'min_value', p.min_value);
    if (!row.max_value && p.max_value != null) frappe.model.set_value(cdt, cdn, 'max_value', p.max_value);
    if (!row.step && p.step != null) frappe.model.set_value(cdt, cdn, 'step', p.step);
    if (!row.select_options && p.options) frappe.model.set_value(cdt, cdn, 'select_options', p.options);
  }
});

frappe.ui.form.on('PackDesign Component', {
  component_type(frm, cdt, cdn) {
    const order = {
      'Cut': 10, 'Crease': 20, 'Perforation': 30, 'Score': 40,
      'Bleed': 50, 'GlueFlap': 60, 'Window': 70, 'Registration': 80,
      'Guide': 90, 'Text': 100, 'Image': 110
    };
    const row = frappe.get_doc(cdt, cdn);
    if (!row.order_index && order[row.component_type]) {
      frappe.model.set_value(cdt, cdn, 'order_index', order[row.component_type]);
    }
  }
});
