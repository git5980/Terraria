import sys, time, json
sys.path.insert(0,'/tmp')
import js, il2b

ALL_GUNS = [95,96,98,164,219,434,533,534,679,800,964,1254,1255,1265,1553,1870,1929,2269,2270,2797,3475,3788,4703,5117,
            197,266,779,905,930,1319,1782,1946,3007,3008,3107,3546,3930,4060]

TEMPLATE = il2b.PRELUDE + r"""
ensureThread();
var main = findClass('Terraria','Main');
var itemCls = findClass('Terraria','Item');
var langCls = findClass('Terraria','Lang');
var sd2 = A.mfromname(itemCls, Memory.allocUtf8String('SetDefaults'), 2);
var getName = A.mfromname(langCls, Memory.allocUtf8String('GetItemNameValue'), 1);
var pf = A.cfield(main, Memory.allocUtf8String('player'), ptr(0));
var buf = Memory.alloc(16); A.static_get(pf, buf, ptr(0));
var p = buf.readPointer().add(0x20).readPointer();
var invArr = p.add(1256).readPointer();
var n = invArr.add(0x18).readU32();
var d = invArr.add(0x20);
var a1 = Memory.alloc(8), a2 = Memory.alloc(8), prm2 = Memory.alloc(16), exc = Memory.alloc(8);
a2.writeU8(0); prm2.writePointer(a1); prm2.add(Process.pointerSize).writePointer(a2);
var prm1 = Memory.alloc(8); prm1.writePointer(a1);
function readStr(sp){ if (!sp || sp.isNull()) return null; try { return sp.add(0x14).readUtf16String(sp.add(0x10).readS32()); } catch(e){ return null; } }
function nameOf(id){ a1.writeS32(id); exc.writePointer(ptr(0)); return readStr(A.runtime_invoke(getName, ptr(0), prm1, exc)); }
var all = ALL_GUNS_JSON;
var have = {}, emptyMain = [], emptyOther = [], usedCount = 0;
for (var i=0;i<n;i++){
  var it = d.add(i*Process.pointerSize).readPointer();
  if (it.isNull()) continue;
  var tp = it.add(76).readS32();
  if (tp === 0) { if (i < 50) emptyMain.push(i); else emptyOther.push(i); continue; }
  usedCount++;
  if (all.indexOf(tp) >= 0) have[tp] = (have[tp] || 0) + 1;
}
var missing = all.filter(function(g){ return !have[g]; });
var dupes = Object.keys(have).filter(function(k){ return have[k] > 1; });
console.log('STATUS used=' + usedCount + ' emptyMain=' + emptyMain.length + ' [' + emptyMain.join(',') + '] emptyOther=[' + emptyOther.join(',') + ']');
console.log('MISSING n=' + missing.length + ' ' + JSON.stringify(missing));
console.log('DUPES ' + JSON.stringify(dupes.map(function(k){ return k + 'x' + have[k]; })));
var placed = [], failed = [];
var slotIdx = 0;
missing.forEach(function(g){
  var slot = null;
  if (slotIdx < emptyMain.length) { slot = emptyMain[slotIdx++]; }
  else if (slotIdx - emptyMain.length < emptyOther.length) { slot = emptyOther[slotIdx++ - emptyMain.length]; }
  if (slot === null) { failed.push([g,'no-slot']); return; }
  var it = d.add(slot*Process.pointerSize).readPointer();
  a1.writeS32(g); exc.writePointer(ptr(0));
  A.runtime_invoke(sd2, it, prm2, exc);
  it.add(96).writeS32(1);
  it.add(344).writeS32(0);
  if (it.add(76).readS32() === g) placed.push([slot, g, nameOf(g)]);
  else failed.push([g, 'mismatch']);
});
console.log('PLACED ' + JSON.stringify(placed));
console.log('FAILED ' + JSON.stringify(failed));
"""

def run():
    code = TEMPLATE.replace('ALL_GUNS_JSON', json.dumps(ALL_GUNS))
    js.call("frida_unload",{"package":"com.xd.terraria"}); time.sleep(0.8)
    js.run(code); time.sleep(4.0)
    return [l for l in js.log(40).get('lines',[]) if l.startswith(('STATUS','MISSING','DUPES','PLACED','FAILED'))]

if __name__ == '__main__':
    for l in run(): print(l[:2500])
