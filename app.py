
import os, json, csv, io, threading, platform, ctypes, struct, subprocess
from pathlib import Path
from flask import Flask, jsonify, request, send_file, render_template
from ctypes import wintypes

APP_ROOT = Path(__file__).parent.resolve()
DATA_DIR = APP_ROOT / "data"
DATA_DIR.mkdir(exist_ok=True)

app = Flask(__name__, template_folder="templates", static_folder="static")

def project_path(name: str) -> Path:
    safe = "".join([c for c in name if c.isalnum() or c in (" ", "_", "-", ".")]).strip()
    if not safe:
        safe = "default"
    return DATA_DIR / f"{safe}.json"

def load_project(name: str):
    p = project_path(name)
    if not p.exists():
        return []
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return []

def save_project(name: str, data):
    p = project_path(name)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, p)

def list_projects():
    return [f.stem for f in DATA_DIR.glob("*.json")]

@app.route("/")
def index():
    return render_template("index.html")

# -------- Projects --------
@app.get("/api/projects")
def api_projects_list():
    names = list_projects()
    if not names:
        seed = [
            {"file":"F:\\\\radio\\\\gorooni1.mp3","tags":["گرونی","پدر پارسا","خادمپور","حمید پارسا","تپق"],"desc":"نمونهٔ اولیه","used": False},
            {"file":"F:\\\\radio\\\\tappagh1.mp3","tags":["تپق","خادمپور"],"desc":"تپق خادمپور","used": False}
        ]
        save_project("رادیو", seed)
        names = ["رادیو"]
    return jsonify(names)

@app.post("/api/projects")
def api_projects_create():
    name = (request.json or {}).get("name","").strip()
    if not name: return jsonify({"error":"name required"}), 400
    if name in list_projects(): return jsonify({"error":"exists"}), 409
    save_project(name, [])
    return jsonify({"ok": True})

@app.put("/api/projects/<old>")
def api_projects_rename(old):
    new = (request.json or {}).get("name","").strip()
    if not new: return jsonify({"error":"name required"}), 400
    po, pn = project_path(old), project_path(new)
    if not po.exists(): return jsonify({"error":"not found"}), 404
    if pn.exists(): return jsonify({"error":"target exists"}), 409
    po.rename(pn); return jsonify({"ok": True})

@app.delete("/api/projects/<name>")
def api_projects_delete(name):
    p = project_path(name)
    if not p.exists(): return jsonify({"error":"not found"}), 404
    p.unlink(); return jsonify({"ok": True})

# -------- Data --------
@app.get("/api/data/<project>")
def api_data_get(project):
    return jsonify(load_project(project))

@app.post("/api/data/<project>")
def api_data_add(project):
    body = request.json or {}
    item = {
        "file": (body.get("file") or "").strip(),
        "tags": [t.strip() for t in (body.get("tags") or []) if t and t.strip()],
        "desc": (body.get("desc") or "").strip(),
        "used": bool(body.get("used"))
    }
    if not item["file"]:
        return jsonify({"error":"file required"}), 400
    data = load_project(project)
    data.append(item)
    save_project(project, data)
    return jsonify({"ok": True})

@app.route("/api/data/<project>/<int:index>", methods=["PUT","POST"])
def api_data_edit(project, index):
    body = request.json or {}
    data = load_project(project)
    if index < 0 or index >= len(data): return jsonify({"error":"index"}), 400
    data[index] = {
        "file": (body.get("file") or "").strip() or data[index].get("file",""),
        "tags": [t.strip() for t in (body.get("tags") or data[index].get("tags",[])) if t and t.strip()],
        "desc": (body.get("desc") or data[index].get("desc","")).strip(),
        "used": bool(body.get("used")) if ("used" in body) else bool(data[index].get("used", False))
    }
    save_project(project, data)
    return jsonify({"ok": True})

@app.delete("/api/data/<project>/<int:index>")
def api_data_delete(project, index):
    data = load_project(project)
    if index < 0 or index >= len(data): return jsonify({"error":"index"}), 400
    data.pop(index); save_project(project, data); return jsonify({"ok": True})

# -------- CSV --------
@app.get("/api/export_csv/<project>")
def api_export_csv(project):
    data = load_project(project)
    s = io.StringIO()
    w = csv.writer(s)
    w.writerow(["file","tags","desc","used"])
    for r in data:
        w.writerow([r.get("file",""), " | ".join(r.get("tags",[])), r.get("desc",""), str(bool(r.get("used", False)))])
    s.seek(0)
    return send_file(io.BytesIO(s.getvalue().encode("utf-8")), mimetype="text/csv",
                     as_attachment=True, download_name=f"{project}-radio_data.csv")

@app.post("/api/import_csv/<project>")
def api_import_csv(project):
    mode = request.args.get("mode","append")
    if "file" not in request.files: return jsonify({"error":"no file"}), 400
    content = request.files["file"].stream.read().decode("utf-8")
    lines = [l for l in content.splitlines() if l.strip()]
    rows = []
    for i, line in enumerate(lines):
        if i==0: continue
        parts = []; cur=""; inq=False
        for ch in line:
            if ch=='"': inq = not inq
            elif ch=="," and not inq: parts.append(cur); cur=""
            else: cur += ch
        parts.append(cur)
        filev = (parts[0] if len(parts)>0 else "").strip()
        tagsv = (parts[1] if len(parts)>1 else "").strip()
        descv = (parts[2] if len(parts)>2 else "").strip()
        usedv = (parts[3] if len(parts)>3 else "").strip().lower() in ("true","1","yes")
        if filev:
            rows.append({"file":filev,"tags":[t.strip() for t in tagsv.split("|") if t.strip()],"desc":descv,"used":usedv})
    data = rows if mode=="replace" else (load_project(project)+rows)
    save_project(project, data)
    return jsonify({"ok": True, "count": len(rows)})

# -------- Clipboard (Windows File Cut) --------
@app.post("/api/cut")
def api_cut():
    body = request.json or {}
    paths = body.get("paths") or []
    if isinstance(paths, str): paths = [paths]
    paths = [p for p in paths if isinstance(p, str) and p.strip()]
    if not paths:
        return jsonify({"error":"paths required"}), 400

    if platform.system() != "Windows":
        try:
            txt = "\r\n".join(paths)
            subprocess.run(["powershell","-NoProfile","-Command", f"Set-Clipboard -Value @'\n{txt}\n'@"], check=True)
            return jsonify({"ok": True, "mode":"text"})
        except Exception as ex:
            return jsonify({"error":"windows required", "detail": str(ex)}), 500

    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32

    # 64-bit safe signatures
    kernel32.GlobalAlloc.restype = wintypes.HGLOBAL
    kernel32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
    kernel32.GlobalLock.restype  = wintypes.LPVOID
    kernel32.GlobalLock.argtypes = [wintypes.HGLOBAL]
    kernel32.GlobalUnlock.restype= wintypes.BOOL
    kernel32.GlobalUnlock.argtypes=[wintypes.HGLOBAL]
    kernel32.GlobalFree.restype  = wintypes.HGLOBAL
    kernel32.GlobalFree.argtypes = [wintypes.HGLOBAL]

    user32.OpenClipboard.restype = wintypes.BOOL
    user32.OpenClipboard.argtypes= [wintypes.HWND]
    user32.EmptyClipboard.restype= wintypes.BOOL
    user32.SetClipboardData.restype = wintypes.HANDLE
    user32.SetClipboardData.argtypes= [wintypes.UINT, wintypes.HANDLE]
    user32.CloseClipboard.restype = wintypes.BOOL

    CF_HDROP = 15
    CF_PREFERREDDROPEFFECT = user32.RegisterClipboardFormatW("Preferred DropEffect")

    class DROPFILES(ctypes.Structure):
        _fields_ = [
            ("pFiles", wintypes.DWORD),
            ("pt_x", wintypes.LONG),
            ("pt_y", wintypes.LONG),
            ("fNC",  wintypes.BOOL),
            ("fWide", wintypes.BOOL),
        ]

    GMEM_MOVEABLE = 0x0002
    GMEM_ZEROINIT = 0x0040

    files_ustr = ("\0".join(paths) + "\0\0").encode("utf-16le")
    hdr = DROPFILES()
    hdr.pFiles = ctypes.sizeof(DROPFILES)
    hdr.pt_x = 0
    hdr.pt_y = 0
    hdr.fNC = False
    hdr.fWide = True

    total_size = ctypes.sizeof(DROPFILES) + len(files_ustr)
    hglobal = kernel32.GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, total_size)
    if not hglobal:
        return jsonify({"error":"GlobalAlloc failed"}), 500

    ptr = kernel32.GlobalLock(hglobal)
    if not ptr:
        kernel32.GlobalFree(hglobal)
        return jsonify({"error":"GlobalLock failed"}), 500

    try:
        base_addr = ctypes.cast(ptr, ctypes.c_void_p).value
        ctypes.memmove(base_addr, ctypes.byref(hdr), ctypes.sizeof(DROPFILES))
        ctypes.memmove(base_addr + ctypes.sizeof(DROPFILES), files_ustr, len(files_ustr))
    finally:
        kernel32.GlobalUnlock(hglobal)

    effect_bytes = struct.pack("<I", 2)  # 2 = move
    hglobal2 = kernel32.GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, len(effect_bytes))
    if not hglobal2:
        kernel32.GlobalFree(hglobal)
        return jsonify({"error":"GlobalAlloc(2) failed"}), 500
    ptr2 = kernel32.GlobalLock(hglobal2)
    try:
        base2 = ctypes.cast(ptr2, ctypes.c_void_p).value
        ctypes.memmove(base2, effect_bytes, len(effect_bytes))
    finally:
        kernel32.GlobalUnlock(hglobal2)

    if not user32.OpenClipboard(None):
        kernel32.GlobalFree(hglobal); kernel32.GlobalFree(hglobal2)
        return jsonify({"error":"OpenClipboard failed"}), 500
    try:
        user32.EmptyClipboard()
        if not user32.SetClipboardData(CF_HDROP, hglobal):
            user32.CloseClipboard()
            kernel32.GlobalFree(hglobal); kernel32.GlobalFree(hglobal2)
            return jsonify({"error":"SetClipboardData(HDROP) failed"}), 500
        user32.SetClipboardData(CF_PREFERREDDROPEFFECT, hglobal2)
    finally:
        user32.CloseClipboard()

    return jsonify({"ok": True, "mode":"file-cut", "count": len(paths)})

def run():
    app.run(host="127.0.0.1", port=8855, debug=False, use_reloader=False)

if __name__ == "__main__":
    run()
