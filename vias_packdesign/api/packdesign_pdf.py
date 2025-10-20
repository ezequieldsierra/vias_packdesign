# apps/vias_packdesign/vias_packdesign/api/packdesign_pdf.py
import re, math, io
import frappe
from io import BytesIO, StringIO

# --- CairoSVG para PDF/SVG ---
import cairosvg

# --- DXF: ezdxf y svgpathtools para interpretar paths ---
try:
    import ezdxf
    from svgpathtools import parse_path
    _HAS_DXF = True
except Exception:
    _HAS_DXF = False

# --- Unidades ---
PX_TO_PT = 72.0 / 96.0   # 1 px @96dpi = 0.75 pt
MM_TO_PT = 72.0 / 25.4
CM_TO_PT = 72.0 / 2.54
IN_TO_PT = 72.0
PC_TO_PT = 12.0
PX_PER_IN = 96.0

# --- Grosor objetivo por capa (en mm) para PDF/SVG/DXF ---
LAYER_WIDTH_MM = {
    "cut":    0.20,
    "crease": 0.30,
    "guide":  0.15,
}

# --- Colores DXF por capa (ACI) ---
DXF_LAYER_COLOR = {
    "cut": 1,     # rojo
    "crease": 3,  # verde
    "guide": 8,   # gris
}

# --- Interpretación de unitless (stroke-width="1") ---
INTERPRET_UNITLESS_AS = "px"  # "px" (0.75pt) o "pt"

# ======================= Utilidades comunes =======================

def _to_pt(value: str) -> str:
    v = (value or "").strip()
    if not v:
        return v
    m = re.match(r'^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(.*)$', v)
    if not m:
        return v
    num, unit = m.group(1), (m.group(2) or "").strip().lower()
    try:
        n = float(num)
    except Exception:
        return v

    if unit == "pt": return f"{n}pt"
    if unit == "mm": return f"{n * MM_TO_PT}pt"
    if unit == "cm": return f"{n * CM_TO_PT}pt"
    if unit in ("in", '"'): return f"{n * IN_TO_PT}pt"
    if unit == "pc": return f"{n * PC_TO_PT}pt"
    if unit == "px": return f"{n * PX_TO_PT}pt"

    if unit == "":
        if INTERPRET_UNITLESS_AS == "px":
            return f"{n * PX_TO_PT}pt"
        return f"{n}pt"

    return v

def _pt_to_mm_str_from_str(pt_str: str) -> str:
    """'0.75pt' -> '0.264583333mm' (string)"""
    try:
        v = float(pt_str.strip().lower().replace("pt",""))
        return f"{v / MM_TO_PT}mm"
    except Exception:
        return pt_str

def _inject_layer_css(svg_text: str, layer_mm: dict) -> str:
    """Inyecta <style> que fuerza stroke-width por capa con !important."""
    rules = []
    for key, mm_val in layer_mm.items():
        w = f"{mm_val}mm"
        sel = (
            f'g[data-layer="{key.capitalize()}"], '
            f'g[data-layer="{key.lower()}"], '
            f'g[data-layer="{key.upper()}"]'
        )
        rules.append(
            f'''{sel} * {{
  stroke-width: {w} !important;
  vector-effect: none !important;
}}'''
        )
    css = "<style type=\"text/css\"><![CDATA[\n" + "\n".join(rules) + "\n]]></style>"
    return re.sub(r'(<svg\b[^>]*>)', r'\1' + css, svg_text, count=1, flags=re.I|re.S)

def normalize_svg_root(svg_text: str, width_mm: float, height_mm: float) -> str:
    """Normaliza root y limpia atributos problemáticos; no toca viewBox."""
    try:
        from lxml import etree
        parser = etree.XMLParser(remove_comments=True, recover=True)
        root = etree.fromstring(svg_text.encode("utf-8"), parser=parser)

        root.attrib["width"]  = f"{float(width_mm)}mm"
        root.attrib["height"] = f"{float(height_mm)}mm"

        style = root.attrib.get("style", "")
        if style:
            new_props = []
            for chunk in style.split(";"):
                chunk = chunk.strip()
                if not chunk or ":" not in chunk:
                    continue
                k, v = [t.strip() for t in chunk.split(":", 1)]
                if k.lower() in ("width", "height"):  # evitar conflictos
                    continue
                new_props.append(f"{k}:{v}")
            if new_props:
                root.attrib["style"] = ";".join(new_props)
            elif "style" in root.attrib:
                del root.attrib["style"]

        for el in root.iter():
            # stroke-width atributo -> pt
            if "stroke-width" in el.attrib:
                el.attrib["stroke-width"] = _to_pt(el.attrib["stroke-width"])

            # stroke-width en style -> pt
            st = el.attrib.get("style")
            if st:
                parts, changed = [], False
                for chunk in st.split(";"):
                    chunk = chunk.strip()
                    if not chunk:
                        continue
                    if ":" not in chunk:
                        parts.append(chunk); continue
                    k, v = [t.strip() for t in chunk.split(":", 1)]
                    kl = k.lower()
                    if kl == "stroke-width":
                        nv = _to_pt(v)
                        parts.append(f"stroke-width:{nv}")
                        changed = changed or (nv != v)
                    elif kl == "stroke-dasharray":
                        if not re.match(r"^\s*(\d+(?:\.\d+)?(?:\s*,\s*\d+(?:\.\d+)?)*|none)\s*$", v, flags=re.I):
                            changed = True
                        else:
                            parts.append(f"{k}:{v}")
                    elif kl == "vector-effect":
                        changed = True
                    else:
                        parts.append(f"{k}:{v}")
                if changed:
                    el.attrib["style"] = ";".join(parts)

            # quitar vector-effect / dasharray inválido en atributo
            if "stroke-dasharray" in el.attrib:
                v = el.attrib["stroke-dasharray"]
                if not re.match(r"^\s*(\d+(?:\.\d+)?(?:\s*,\s*\d+(?:\.\d+)?)*|none)\s*$", v, flags=re.I):
                    el.attrib.pop("stroke-dasharray", None)
            if "vector-effect" in el.attrib:
                el.attrib.pop("vector-effect", None)

        return etree.tostring(root, encoding="utf-8", xml_declaration=False).decode("utf-8")

    except Exception:
        # Fallback simple
        s = svg_text
        s = re.sub(r'(<svg[^>]*?)\swidth="[^"]*"', r"\1", s, flags=re.I)
        s = re.sub(r'(<svg[^>]*?)\sheight="[^"]*"', r"\1", s, flags=re.I)
        s = re.sub(r"<svg", f'<svg width="{float(width_mm)}mm" height="{float(height_mm)}mm"', s, count=1, flags=re.I)
        s = re.sub(r'stroke-width="\s*([^"]+?)\s*"', lambda m: f'stroke-width="{_to_pt(m.group(1))}"', s, flags=re.I)
        s = re.sub(r'stroke-width\s*:\s*([^;"]+)', lambda m: f'stroke-width:{_to_pt(m.group(1))}', s, flags=re.I)
        s = re.sub(r'\svector-effect="[^"]*"', "", s, flags=re.I)
        s = re.sub(r'vector-effect\s*:\s*[^;]+;?', "", s, flags=re.I)
        s = re.sub(r'\sstroke-dasharray="(?!none)[^"]*"', "", s, flags=re.I)
        s = re.sub(r'stroke-dasharray\s*:\s*(?!none)[^;]+;?', "", s, flags=re.I)
        return s

# ======================= Export: PDF =======================

@frappe.whitelist(methods=["POST"])
def export_packdesign_instance_pdf(
    docname: str,
    svg: str,
    width_mm: float,
    height_mm: float,
    filename: str | None = None,
    is_private: int = 0,
):
    """SVG → PDF vectorial (CairoSVG), grosores por capa vía CSS inyectado."""
    if not svg or not width_mm or not height_mm:
        frappe.throw("SVG y dimensiones (mm) son requeridos.")

    svg_clean = normalize_svg_root(svg, width_mm, height_mm)
    svg_clean = _inject_layer_css(svg_clean, LAYER_WIDTH_MM)

    buf = BytesIO()
    cairosvg.svg2pdf(
        bytestring=svg_clean.encode("utf-8"),
        write_to=buf,
        dpi=96,
        background_color="white",
    )
    pdf_bytes = buf.getvalue()
    buf.close()

    if not filename:
        filename = f"{frappe.utils.now_datetime().strftime('%Y%m%d-%H%M%S')}.pdf"
    if not filename.lower().endswith(".pdf"):
        filename += ".pdf"

    filedoc = frappe.get_doc(
        {
            "doctype": "File",
            "file_name": filename,
            "is_private": int(is_private or 0),
            "content": pdf_bytes,
            "attached_to_doctype": "PackDesign Instance",
            "attached_to_name": docname,
        }
    )
    filedoc.insert(ignore_permissions=True)
    frappe.db.commit()
    return {"file_url": filedoc.file_url, "file_name": filedoc.file_name}

# ======================= Export: SVG (guardar tal cual, normalizado) =======================

@frappe.whitelist(methods=["POST"])
def export_packdesign_instance_svg(
    docname: str,
    svg: str,
    width_mm: float,
    height_mm: float,
    filename: str | None = None,
    is_private: int = 0,
):
    """Guarda el SVG (normalizado + CSS de capas)."""
    if not svg or not width_mm or not height_mm:
        frappe.throw("SVG y dimensiones (mm) son requeridos.")

    svg_clean = normalize_svg_root(svg, width_mm, height_mm)
    svg_clean = _inject_layer_css(svg_clean, LAYER_WIDTH_MM)

    # Asegurar cabecera XML opcional
    if not svg_clean.lstrip().startswith("<?xml"):
        svg_clean = '<?xml version="1.0" encoding="UTF-8"?>\n' + svg_clean

    if not filename:
        filename = f"{frappe.utils.now_datetime().strftime('%Y%m%d-%H%M%S')}.svg"
    if not filename.lower().endswith(".svg"):
        filename += ".svg"

    filedoc = frappe.get_doc(
        {
            "doctype": "File",
            "file_name": filename,
            "is_private": int(is_private or 0),
            "content": svg_clean.encode("utf-8"),
            "attached_to_doctype": "PackDesign Instance",
            "attached_to_name": docname,
        }
    )
    filedoc.insert(ignore_permissions=True)
    frappe.db.commit()
    return {"file_url": filedoc.file_url, "file_name": filedoc.file_name}

# ======================= Export: DXF =======================

# Affine helpers (a b c d e f) SVG 2D
def _mul(A, B):
    a,b,c,d,e,f = A; a2,b2,c2,d2,e2,f2 = B
    return (a*a2 + c*b2, b*a2 + d*b2, a*c2 + c*d2, b*c2 + d*d2, a*e2 + c*f2 + e, b*e2 + d*f2 + f)
def _mat_scale(sx, sy): return (sx,0.0,0.0,sy,0.0,0.0)
def _mat_rotate(deg):
    rad = math.radians(float(deg)); c,s = math.cos(rad), math.sin(rad)
    return (c,s,-s,c,0.0,0.0)
def _mat_translate(tx, ty): return (1.0,0.0,0.0,1.0,tx,ty)
def _mat_skewX(deg): t = math.tan(math.radians(float(deg))); return (1.0,0.0,t,1.0,0.0,0.0)
def _mat_skewY(deg): t = math.tan(math.radians(float(deg))); return (1.0,t,0.0,1.0,0.0,0.0)

def _parse_transform_attr(s: str):
    M = (1.0,0.0,0.0,1.0,0.0,0.0)
    if not s: return M
    for fn, args in re.findall(r'([a-zA-Z]+)\s*\(([^)]*)\)', s):
        fnl = fn.strip().lower()
        nums = [float(x) for x in re.split(r'[ ,]+', args.strip()) if x]
        if fnl == "matrix" and len(nums)==6: m = tuple(nums)
        elif fnl == "translate": m = _mat_translate(nums[0] if nums else 0.0, nums[1] if len(nums)>1 else 0.0)
        elif fnl == "scale":
            sx = nums[0] if nums else 1.0; sy = nums[1] if len(nums)>1 else sx; m = _mat_scale(sx, sy)
        elif fnl == "rotate":  m = _mat_rotate(nums[0] if nums else 0.0)
        elif fnl == "skewx":   m = _mat_skewX(nums[0] if nums else 0.0)
        elif fnl == "skewy":   m = _mat_skewY(nums[0] if nums else 0.0)
        else: continue
        M = _mul(M, m)
    return M

def _apply_mat(M, x, y):
    a,b,c,d,e,f = M
    return (a*x + c*y + e, b*x + d*y + f)

def _collect_ancestors_transform(el):
    M = (1.0,0.0,0.0,1.0,0.0,0.0)
    cur = el
    try:
        parent = cur.getparent()
    except Exception:
        parent = None
    while parent is not None:
        tf = parent.attrib.get("transform")
        if tf: M = _mul(_parse_transform_attr(tf), M)
        try:
            parent = parent.getparent()
        except Exception:
            parent = None
    return M

def _vb_to_mm(viewbox, width_mm, height_mm, x, y):
    """Convierte punto SVG (x,y) en mm, invirtiendo eje Y (DXF Y hacia arriba)."""
    minx, miny, vbw, vbh = viewbox
    sx = float(width_mm) / float(vbw)
    sy = float(height_mm) / float(vbh)
    X = (x - minx) * sx
    Y = (miny + vbh - y) * sy  # invertir eje Y
    return X, Y

def _nearest_layer(el):
    cur = el
    while cur is not None:
        dl = cur.attrib.get("data-layer")
        if dl: return dl.strip().lower()
        try:
            cur = cur.getparent()
        except Exception:
            cur = None
    return ""

def _ensure_dxf_layers(doc):
    for lname, color in DXF_LAYER_COLOR.items():
        if lname.upper() not in doc.layers:
            doc.layers.add(lname.upper(), color=color)

@frappe.whitelist(methods=["POST"])
def export_packdesign_instance_dxf(
    docname: str,
    svg: str,
    width_mm: float,
    height_mm: float,
    filename: str | None = None,
    is_private: int = 0,
):
    """SVG → DXF (en milímetros), con capas (CUT/CREASE/GUIDE) y grosores aproximados."""
    if not svg or not width_mm or not height_mm:
        frappe.throw("SVG y dimensiones (mm) son requeridos.")

    if not _HAS_DXF:
        frappe.throw("Dependencias DXF no disponibles. Instala ezdxf y svgpathtools.")

    # Normaliza y limpia (esto elimina vector-effect y arregla stroke-width a pt)
    svg_clean = normalize_svg_root(svg, width_mm, height_mm)

    # Parse XML
    from lxml import etree
    parser = etree.XMLParser(remove_comments=True, recover=True)
    root = etree.fromstring(svg_clean.encode("utf-8"), parser=parser)

    # viewBox
    vb_attr = root.attrib.get("viewBox")
    if not vb_attr:
        minx, miny, vbw, vbh = 0.0, 0.0, float(width_mm), float(height_mm)
    else:
        vb = [float(x) for x in re.split(r"[ ,]+", vb_attr.strip()) if x]
        if len(vb) != 4: frappe.throw("viewBox inválido en SVG.")
        minx, miny, vbw, vbh = vb

    viewbox = (minx, miny, vbw, vbh)

    # Crear DXF con unidades explícitas en mm
    from ezdxf import units

    doc = ezdxf.new("R2010")
    doc.units = units.MM                # establece $INSUNITS a milímetros
    doc.header["$INSUNITS"] = 4         # milímetros (explícito para visores tercos)
    doc.header["$MEASUREMENT"] = 1      # métrico
    msp = doc.modelspace()

    # Helper para lineweight (1/100 mm)
    def lw_from_layer(layer_name: str) -> int:
        mm = LAYER_WIDTH_MM.get(layer_name, 0.20)
        return max(0, min(211, int(round(mm * 100))))  # DXF LWD: 0..211 (1/100 mm)

    # Asegurar capas
    _ensure_dxf_layers(doc)

    # Recorre elementos relevantes
    for el in root.iter():
        tag = etree.QName(el).localname.lower()
        if tag not in ("line", "polyline", "polygon", "path"):
            continue

        # Capa
        layer = _nearest_layer(el) or "cut"
        layer_upper = layer.upper()
        if layer_upper not in doc.layers:
            doc.layers.add(layer_upper, color=DXF_LAYER_COLOR.get(layer, 7))

        # Transform acumulada del elemento + ancestros
        M = _parse_transform_attr(el.attrib.get("transform", ""))
        M = _mul(_collect_ancestors_transform(el), M)

        # Lineweight por capa
        lweight = lw_from_layer(layer)

        if tag == "line":
            try:
                x1 = float(el.attrib.get("x1", "0")); y1 = float(el.attrib.get("y1", "0"))
                x2 = float(el.attrib.get("x2", "0")); y2 = float(el.attrib.get("y2", "0"))
                x1,y1 = _apply_mat(M, x1, y1)
                x2,y2 = _apply_mat(M, x2, y2)
                X1,Y1 = _vb_to_mm(viewbox, width_mm, height_mm, x1, y1)
                X2,Y2 = _vb_to_mm(viewbox, width_mm, height_mm, x2, y2)
                msp.add_line((X1,Y1), (X2,Y2), dxfattribs={"layer": layer_upper, "lineweight": lweight})
            except Exception:
                continue

        elif tag in ("polyline", "polygon"):
            pts_attr = el.attrib.get("points","").strip()
            if not pts_attr:
                continue
            pts = []
            for pair in re.split(r'\s+', pts_attr):
                if not pair.strip(): continue
                parts = pair.split(",")
                if len(parts) != 2: continue
                try:
                    x = float(parts[0]); y = float(parts[1])
                except Exception:
                    continue
                x,y = _apply_mat(M, x, y)
                X,Y = _vb_to_mm(viewbox, width_mm, height_mm, x, y)
                pts.append((X,Y))
            if not pts:
                continue
            is_closed = (tag == "polygon") or (el.attrib.get("fill","none") not in ("none","","transparent"))
            msp.add_lwpolyline(pts, format="xy", dxfattribs={"layer": layer_upper, "lineweight": lweight, "closed": is_closed})

        elif tag == "path":
            d = el.attrib.get("d","").strip()
            if not d:
                continue
            try:
                path = parse_path(d)
            except Exception:
                continue
            # Muestreamos el path a segmentos cortos (~0.5 mm)
            step_mm = 0.5
            step_u = step_mm * (float(vbw) / float(width_mm)) if float(width_mm) != 0 else 0.5
            try:
                length_u = path.length(error=1e-3)
            except Exception:
                length_u = max(abs(vbw), abs(vbh))
            n = max(2, int(max(2, math.ceil(length_u / max(1e-6, step_u)))))
            pts = []
            for i in range(n+1):
                t = i / n
                z = path.point(t)
                x, y = float(z.real), float(z.imag)
                x,y = _apply_mat(M, x, y)
                X,Y = _vb_to_mm(viewbox, width_mm, height_mm, x, y)
                if i==0 or (abs(X-pts[-1][0])>1e-6 or abs(Y-pts[-1][1])>1e-6):
                    pts.append((X,Y))
            if len(pts) >= 2:
                closed = (abs(pts[0][0]-pts[-1][0])<1e-6 and abs(pts[0][1]-pts[-1][1])<1e-6)
                msp.add_lwpolyline(
                    pts,
                    format="xy",
                    dxfattribs={"layer": layer_upper, "lineweight": lweight, "closed": closed},
                )

    # Serializar DXF (texto) -> bytes
    text_buf = StringIO()
    doc.write(text_buf)
    dxf_text = text_buf.getvalue()
    text_buf.close()
    out = dxf_text.encode("utf-8")

    if not filename:
        filename = f"{frappe.utils.now_datetime().strftime('%Y%m%d-%H%M%S')}.dxf"
    if not filename.lower().endswith(".dxf"):
        filename += ".dxf"

    filedoc = frappe.get_doc(
        {
            "doctype": "File",
            "file_name": filename,
            "is_private": int(is_private or 0),
            "content": out,
            "attached_to_doctype": "PackDesign Instance",
            "attached_to_name": docname,
        }
    )
    filedoc.insert(ignore_permissions=True)
    frappe.db.commit()
    return {"file_url": filedoc.file_url, "file_name": filedoc.file_name}
