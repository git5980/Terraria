import sys, time
sys.path.insert(0,'/tmp')
import js, il2b

CODE = il2b.PRELUDE + r"""
ensureThread();
var main = findClass('Terraria','Main');
function fld(n){ return A.cfield(main, Memory.allocUtf8String(n), ptr(0)); }
function get(n, kind){
  var f = fld(n); if (!f || f.isNull()) return null;
  var buf = Memory.alloc(16); A.static_get(f, buf, ptr(0));
  if (kind==='bool') return buf.readU8();
  if (kind==='int') return buf.readS32();
  if (kind==='double') return buf.readDouble();
  return buf.readU32();
}
function set(n, kind, v){
  var f = fld(n); if (!f || f.isNull()) return false;
  var buf = Memory.alloc(16);
  if (kind==='bool') buf.writeU8(v);
  else if (kind==='int') buf.writeS32(v);
  else if (kind==='double') buf.writeDouble(v);
  A.static_set(f, buf);
  return true;
}
function report(tag){
  var t = get('time','double'), d = get('dayTime','bool'), r = get('dayRate','int');
  var hh = ((t/3600)+4.5) % 24, mm = Math.round((hh % 1)*60);
  console.log(tag + ' dayTime=' + d + ' time=' + Math.round(t) + ' (~' + Math.floor(hh) + ':' + (mm<10?'0':'')+mm + ') dayRate=' + r
    + ' bloodMoon=' + get('bloodMoon','bool') + ' eclipse=' + get('eclipse','bool'));
}
report('BEFORE');
set('dayTime','bool',1);
set('time','double',27000);
set('dayRate','int',0);
report('AFTER ');
"""
def run():
    js.call("frida_unload",{"package":"com.xd.terraria"}); time.sleep(0.8)
    js.run(CODE); time.sleep(1.8)
    return [l for l in js.log(20).get('lines',[]) if l.startswith(('BEFORE','AFTER'))]
if __name__ == '__main__':
    for l in run(): print(l)
