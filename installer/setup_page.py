"""A tiny local web page that shows the guided setup's progress (used by connect_setup.py).

It listens on 127.0.0.1 only, on a random port, and serves two read-only things: the page and its status as JSON. The page
polls the status every 2 s, so it follows the terminal checklist and shows what to do at the step that is waiting. No input
comes from the browser, and the page puts every text in with textContent, never as HTML.
"""
from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Accio Studio setup</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#1b1f24;--mute:#5d6672;--line:#dfe3e8;--ok:#1a7f45;--warn:#b25e09;--bad:#b3261e;--accent:#2f5bea;--on-accent:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#14171b;--card:#1d2127;--ink:#e8eaed;--mute:#98a1ad;--line:#2c323a;--ok:#4cc27f;--warn:#e8a04a;--bad:#ff8a80;--accent:#7b9bff;--on-accent:#0d1220}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,Segoe UI,sans-serif}
main{max-width:640px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:1.4rem;margin:0 0 4px}.sub{color:var(--mute);margin:0 0 20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:16px}
ol{list-style:none;margin:0;padding:0}li{display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-top:1px solid var(--line)}
li:first-child{border-top:0}.dot{flex:none;width:26px;height:26px;border-radius:50%;border:2px solid var(--line);display:grid;place-items:center;font-size:14px;font-weight:700;color:var(--mute)}
.done .dot{border-color:var(--ok);background:var(--ok);color:var(--on-accent)}.wait .dot{border-color:var(--accent);color:var(--accent)}.fail .dot{border-color:var(--bad);color:var(--bad)}
.wait .dot::after{content:"";width:10px;height:10px;border-radius:50%;background:var(--accent);animation:p 1.2s infinite}
@keyframes p{50%{opacity:.25}}
.label{padding-top:2px}.todo .label{color:var(--mute)}.wait .label{font-weight:600}
.hint h2{font-size:1.05rem;margin:0 0 6px}.hint p{margin:0 0 12px;white-space:pre-line}
a.btn{display:inline-block;background:var(--accent);color:var(--on-accent);text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600}
.final{border-color:var(--ok)}.final h2{color:var(--ok)}.fail-card{border-color:var(--bad)}.fail-card h2{color:var(--bad)}
code{background:var(--bg);padding:2px 6px;border-radius:6px;word-break:break-all}
[hidden]{display:none!important}
</style></head><body><main>
<h1>Tailscale setup</h1><p class="sub">Each step is checked automatically. This page moves on by itself.</p>
<div class="card"><ol id="steps"></ol></div>
<div class="card hint" id="hint" hidden><h2 id="hint-title"></h2><p id="hint-text"></p><a class="btn" id="hint-link" hidden target="_blank" rel="noopener"></a></div>
<div class="card final" id="final" hidden><h2>All set. You can now close this window.</h2>
<p>Your address (only devices signed into your Tailscale account can open it):</p><p><code id="addr"></code></p>
<p id="next"></p></div>
<div class="card fail-card" id="fail" hidden><h2>Setup stopped</h2><p id="fail-text"></p></div>
</main><script>
const MARK={todo:"",wait:"",done:"\\u2713",fail:"!"};
function render(s){
  const ol=document.getElementById("steps");ol.textContent="";
  s.steps.forEach((t,i)=>{const li=document.createElement("li");li.className=s.status[i];
    const d=document.createElement("span");d.className="dot";d.textContent=MARK[s.status[i]]||(s.status[i]==="todo"?String(i+1):"");
    const l=document.createElement("span");l.className="label";l.textContent=t;li.append(d,l);ol.append(li);});
  const h=s.hint,hint=document.getElementById("hint");
  hint.hidden=!h||s.done||s.failed;
  if(h){document.getElementById("hint-title").textContent=h.title;document.getElementById("hint-text").textContent=h.text;
    const a=document.getElementById("hint-link");
    if(h.link&&h.link.startsWith("https://")){a.href=h.link;a.textContent=h.button||"Open";a.hidden=false}else{a.hidden=true}}
  document.getElementById("final").hidden=!s.done;
  if(s.done){document.getElementById("addr").textContent=s.address||"";document.getElementById("next").textContent=s.next||""}
  document.getElementById("fail").hidden=!s.failed;
  if(s.failed)document.getElementById("fail-text").textContent=s.failed;
}
let last=null,dead=0;
async function tick(){
  try{const r=await fetch("/status",{cache:"no-store"});last=await r.json();dead=0;render(last)}
  catch(e){dead++;if(last&&last.done){return}}
  setTimeout(tick,2000);
}
tick();
</script></body></html>
"""


class GuidePage:
    """State shown by the page. `update` is called from the setup thread, the server thread only reads."""

    def __init__(self, steps: list[str]):
        self._lock = threading.Lock()
        self._state: dict = {"steps": steps, "status": ["todo"] * len(steps), "hint": None, "done": False,
                             "address": "", "next": "", "failed": ""}
        self._server: ThreadingHTTPServer | None = None
        self.url = ""

    def update(self, **fields) -> None:
        with self._lock:
            self._state.update(fields)

    def snapshot(self) -> bytes:
        with self._lock:
            return json.dumps(self._state).encode()

    def start(self) -> str:
        page = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args) -> None:  # keep the terminal checklist clean
                pass

            def do_GET(self) -> None:  # noqa: N802
                host = (self.headers.get("Host") or "").split(":")[0]
                if host not in ("127.0.0.1", "localhost"):  # not a name an outside page could point at us
                    self.send_error(403)
                    return
                if self.path == "/":
                    body, kind = PAGE.encode(), "text/html; charset=utf-8"
                elif self.path == "/status":
                    body, kind = page.snapshot(), "application/json"
                else:
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header("Content-Type", kind)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.end_headers()
                self.wfile.write(body)

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self._server.serve_forever, daemon=True, name="setup-page").start()
        self.url = f"http://127.0.0.1:{self._server.server_address[1]}/"
        return self.url

    def stop(self) -> None:
        if self._server:
            self._server.shutdown()
            self._server.server_close()
