
import os, sys, threading, json, socket, traceback
os.environ.setdefault('NO_PROXY','127.0.0.1,localhost')
os.environ.setdefault('no_proxy','127.0.0.1,localhost')
from urllib.request import Request, urlopen, build_opener, ProxyHandler
from urllib.parse import quote
from PySide6.QtCore import QUrl, QTimer
from PySide6.QtWidgets import QApplication, QMainWindow, QMessageBox
from PySide6.QtWebEngineWidgets import QWebEngineView

os.environ["FLASK_RUN_FROM_CLI"] = "false"

WAIT_HTML = """
<!doctype html><meta charset="utf-8">
<body style="margin:0;background:#0b0e13;color:#cbd5e1;font:14px/1.6 system-ui">
<div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column">
  <div style="opacity:.8">در حال راه‌اندازی سرویس محلی…</div>
  <div id="st" style="margin-top:8px;opacity:.6">در حال انتظار برای <b>127.0.0.1:8855</b></div>
</div>
</body>
"""

def start_server():
    try:
        import app as webapp
        webapp.run()
    except Exception:
        print("\\n=== Flask server crashed ===")
        traceback.print_exc()

srv = threading.Thread(target=start_server, daemon=True)
srv.start()

def port_ready(host="127.0.0.1", port=8855, timeout=0.3):
    s = socket.socket()
    s.settimeout(timeout)
    try:
        s.connect((host, port)); s.close(); return True
    except Exception:
        return False

JS_SET_HOVER = r"""
(function(x,y){
  var el = document.elementFromPoint(x,y);
  var card = el && el.closest ? el.closest('.file') : null;
  var idx = null;
  if(card){
    var ed = card.querySelector('[data-edit]');
    idx = ed ? ed.getAttribute('data-edit') : null;
  }
  Array.prototype.forEach.call(document.querySelectorAll('.file.rm-hover'),
    function(c){ c.classList.remove('rm-hover'); });
  if(card){ card.classList.add('rm-hover'); }
  window.__hoverIndex = idx;
})(%d,%d);
"""

class WebView(QWebEngineView):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.setAcceptDrops(True)
        self._drop_lock = False

    def dragEnterEvent(self, e):
        if e.mimeData().hasUrls() or e.mimeData().hasText():
            e.acceptProposedAction()

    def dragMoveEvent(self, e):
        pos = e.position().toPoint()
        self.page().runJavaScript(JS_SET_HOVER % (pos.x(), pos.y()))
        e.acceptProposedAction()

    def dragLeaveEvent(self, e):
        self.page().runJavaScript(
            "Array.prototype.forEach.call(document.querySelectorAll('.file.rm-hover'),c=>c.classList.remove('rm-hover'));"
            "window.__hoverIndex=null;"
        )

    def dropEvent(self, e):
        if self._drop_lock: return
        self._drop_lock = True
        try:
            e.acceptProposedAction()
            path = ""
            if e.mimeData().hasUrls():
                urls = e.mimeData().urls()
                if urls: path = urls[0].toLocalFile()
            elif e.mimeData().hasText():
                t = e.mimeData().text()
                path = QUrl(t).toLocalFile() if t.startswith('file:///') else t
            if not path:
                self._drop_lock = False; return

            def got_index(orig):
                if not orig:
                    self._drop_lock = False
                    QMessageBox.information(self.window(), "دراگ‌اَند‌دراپ",
                        "کارت مقصد تشخیص نشد. فایل را روی خود کارت رها کنید.")
                    return

                def got_project(project):
                    try:
                        data = json.dumps({"file": path}).encode("utf-8")
                        url = f"http://127.0.0.1:8855/api/data/{quote(project)}/{int(orig)}"
                        req = Request(url, data=data,
                                      headers={"Content-Type":"application/json"},
                                      method="PUT")
                        build_opener(ProxyHandler({})).open(req).read()
                    except Exception as ex:
                        print("drop save error:", ex)
                    self.page().runJavaScript(
                        "window.loadProjectData && window.loadProjectData(((document.querySelector('#projectSelect')||{}).value || window.currentProject), {keepFilters:true});"
                    )
                    self._drop_lock = False

                self.page().runJavaScript(
                    "((document.querySelector('#projectSelect')||{}).value || window.currentProject || '')",
                    got_project)

            self.page().runJavaScript("window.__hoverIndex", got_index)
        except Exception:
            self._drop_lock = False

class Win(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("رادیو مپ — ویندوز")
        self.resize(1280, 800)
        self.v = WebView(self)
        self.setCentralWidget(self.v)
        self.v.setHtml(WAIT_HTML)
        self._try_load()

    def _try_load(self):
        if port_ready():
            self.v.setUrl(QUrl("http://127.0.0.1:8855/"))
        else:
            QTimer.singleShot(300, self._try_load)

def main():
    app = QApplication(sys.argv)
    w = Win(); w.show()
    sys.exit(app.exec())

if __name__ == "__main__":
    main()
