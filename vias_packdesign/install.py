import frappe

def after_install():
    module = "VIAS PackDesign"
    if not frappe.db.exists("Module Def", module):
        md = frappe.new_doc("Module Def")
        md.module_name = module
        md.app_name = "vias_packdesign"
        md.package = "vias_packdesign"
        md.insert(ignore_permissions=True)
