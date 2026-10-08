import json,urllib.request,re
KEY="6447733a9f81ec0f7d98269e446502f9305903332700311b129b69f5354b1a4f"
URL="http://127.0.0.1:19820/mcp"
def new_session():
    body=json.dumps({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"dsh","version":"1"}}}).encode()
    req=urllib.request.Request(URL,data=body,headers={"Content-Type":"application/json","Accept":"application/json, text/event-stream","X-Api-Key":KEY})
    with urllib.request.urlopen(req,timeout=30) as r:
        sid=r.headers.get("Mcp-Session-Id")
    open("/tmp/jshook_sid","w").write(sid)
    return sid
def _sid():
    try:
        s=open("/tmp/jshook_sid").read().strip()
        if s and s.startswith("jshook-"): return s
    except OSError: pass
    return new_session()
def rpc(method,params=None,id=1):
    sid=_sid()
    body=json.dumps({"jsonrpc":"2.0","id":id,"method":method,"params":params or {}}).encode()
    req=urllib.request.Request(URL,data=body,headers={"Content-Type":"application/json","Accept":"application/json, text/event-stream","X-Api-Key":KEY,"Mcp-Session-Id":sid})
    with urllib.request.urlopen(req,timeout=120) as r:
        return json.loads(r.read().decode())
def call(name,args,id=1):
    d=rpc("tools/call",{"name":name,"arguments":args},id)
    if "error" in d: return {"error":d["error"]}
    txt=d.get("result",{}).get("content",[{}])[0].get("text","")
    try: return json.loads(txt)
    except Exception: return {"raw":txt}
def run(code,id=1): return call("frida_execute",{"package":"com.xd.terraria","code":code},id)
def log(tail=60,offset=0): return call("frida_read_log",{"package":"com.xd.terraria","tail":tail,"offset":offset},id=999)
def show():
    d=log(40)
    for l in d.get("lines",[]): print(l)
