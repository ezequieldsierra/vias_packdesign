import frappe

def _category_link_field():
    row = frappe.db.sql(
        """
        SELECT fieldname
        FROM `tabDocField`
        WHERE parent='PackDesign Template' AND fieldtype='Link' AND options='PackDesign Category'
        ORDER BY idx
        LIMIT 1
        """,
        as_dict=True,
    )
    return row[0].fieldname if row else "category"

@frappe.whitelist()
def category_children(parent=None, txt="", page_len=100, start=0):
    txt = (txt or "").strip()
    like = f"%{txt}%"
    if parent in (None, "", "null"):
        cond_parent = "c.parent_packdesign_category IS NULL"
        params = {"like": like, "start": int(start), "page_len": int(page_len)}
    else:
        cond_parent = "c.parent_packdesign_category = %(parent)s"
        params = {"like": like, "start": int(start), "page_len": int(page_len), "parent": parent}
    rows = frappe.db.sql(
        f"""
        SELECT c.name, c.is_group,
               (SELECT COUNT(*) FROM `tabPackDesign Category` x WHERE x.parent_packdesign_category=c.name) AS children
        FROM `tabPackDesign Category` c
        WHERE {cond_parent} AND c.name LIKE %(like)s
        ORDER BY c.lft
        LIMIT %(start)s, %(page_len)s
        """,
        params, as_dict=True
    )
    out = []
    for r in rows:
        out.append({"name": r.name, "is_group": int(r.is_group or 0), "children": int(r.children or 0)})
    return out

@frappe.whitelist()
def templates_under(category, txt="", page_len=100, start=0):
    if not category:
        return []
    fieldname = _category_link_field()
    txt = (txt or "").strip()
    like = f"%{txt}%"
    rows = frappe.db.sql(
        f"""
        SELECT name
        FROM `tabPackDesign Template`
        WHERE `{fieldname}` = %(cat)s AND name LIKE %(like)s
        ORDER BY name
        LIMIT %(start)s, %(page_len)s
        """,
        {"cat": category, "like": like, "start": int(start), "page_len": int(page_len)},
        as_dict=True,
    )
    return [r.name for r in rows]

@frappe.whitelist()
def template_path(template_name):
    if not template_name:
        return {"path": "", "category": None}
    fieldname = _category_link_field()
    tpl = frappe.db.get_value("PackDesign Template", template_name, [fieldname], as_dict=True)
    if not tpl:
        return {"path": template_name, "category": None}
    cat = tpl.get(fieldname)
    if not cat:
        return {"path": template_name, "category": None}
    node = frappe.db.get_value("PackDesign Category", cat, ["lft","rgt"], as_dict=True)
    if not node:
        return {"path": template_name, "category": cat}
    ancestors = frappe.db.sql(
        """
        SELECT p.name
        FROM `tabPackDesign Category` p
        WHERE p.lft <= %(lft)s AND p.rgt >= %(rgt)s
        ORDER BY p.lft
        """,
        {"lft": node.lft, "rgt": node.rgt}, as_dict=True
    )
    path = " / ".join([a.name for a in ancestors] + [template_name])
    return {"path": path, "category": cat}
