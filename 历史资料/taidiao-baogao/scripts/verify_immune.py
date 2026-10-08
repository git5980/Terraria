import sys, time
sys.path.insert(0,'/tmp')
import js, il2b

CODE = il2b.PRELUDE + r"""
ensureThread();
var main = findClass('Terraria','Main');
var pf = A.cfield(main, Memory.allocUtf8String('player'), ptr(0));
var buf = Memory.alloc(16); A.static_get(pf, buf, ptr(0));
var p = buf.readPointer().add(0x20).readPointer();
console.log('CHK hp=' + p.add(1984).readS32() + '/' + p.add(1976).readS32()
  + ' immune=' + p.add(976).readU8() + ' immuneTime=' + p.add(980).readS32()
  + ' knockback=' + p.add(2025).readU8() + ' fallDmg=' + p.add(2870).readU8()
  + ' dead=' + p.add(1432).readU8());
"""
def check():
    js.call("frida_unload",{"package":"com.xd.terraria"}); time.sleep(0.8)
    js.run(CODE); time.sleep(1.8)
    for l in js.log(20).get('lines',[]):
        if l.startswith('CHK'): return l
    return None
if __name__ == '__main__':
    for i in range(3):
        print(f"[{time.strftime('%H:%M:%S')}] {check()}", flush=True)
        if i < 2: time.sleep(4)
