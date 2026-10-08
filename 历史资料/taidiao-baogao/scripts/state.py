import sys, json, time
sys.path.insert(0,'/tmp')
import js, il2

CODE = il2.PRELUDE + r"""
var main = findClass('Terraria','Main');
var playerCls = findClass('Terraria','Player');
function sv(n, kind){
  var f = A.cfield(main, Memory.allocUtf8String(n), ptr(0));
  if (!f || f.isNull()) return null;
  var buf = Memory.alloc(16); A.static_get(f, buf, ptr(0));
  if (kind==='ptr') return buf.readPointer();
  if (kind==='bool') return buf.readU8();
  if (kind==='int') return buf.readS32();
  return buf.readU32();
}
function slot(p, off){
  var f = A.cfield(playerCls, Memory.allocUtf8String('__x__'), ptr(0));
  return null;
}
var arr = sv('player','ptr');
var out = { t: Date.now(), players: [] };
if (arr && !arr.isNull()) {
  var base = arr.add(0x20);
  for (var i=0;i<4;i++){
    var p = base.add(i*Process.pointerSize).readPointer();
    if (p.isNull() || !p.add(73).readU8()) continue;
    var rec = {
      slot: i,
      hp: p.add(1984).readS32(), hpMax: p.add(1976).readS32(), hpMax2: p.add(1980).readS32(),
      mp: p.add(1988).readS32(), mpMax: p.add(1992).readS32(), mpMax2: p.add(1996).readS32(),
      defense: p.add(1972).readS32(),
      x: Math.round(p.add(20).readFloat()), y: Math.round(p.add(24).readFloat()),
      vx: +p.add(28).readFloat().toFixed(2), vy: +p.add(32).readFloat().toFixed(2),
      dead: p.add(1432).readU8(), breath: p.add(1188).readS32(), breathMax: p.add(1184).readS32(),
      inv: [], armor: []
    };
    // inventory / armor arrays are Item[] : il2cpp array header 0x20 then elements
    function readItems(arrPtr, maxN, label){
      var res = [];
      if (arrPtr.isNull()) return res;
      var len = 0;
      try { len = A.arrlen(arrPtr, ptr(0)); } catch(e){ len = 0; }
      var n = Math.min(len, maxN);
      var b = arrPtr.add(0x20);
      for (var k=0;k<n;k++){
        var it = b.add(k*Process.pointerSize).readPointer();
        if (it.isNull()) continue;
        var tp = it.add(76).readS32();
        var st = it.add(96).readS32();
        var px = it.add(344).readS32();
        if (tp > 0) res.push({ i: k, type: tp, stack: st, prefix: px });
      }
      return res;
    }
    rec.inv = readItems(p.add(1256).readPointer(), 60, 'inv');
    rec.armor = readItems(p.add(1088).readPointer(), 20, 'armor');
    out.players.push(rec);
  }
}
console.log('STATE ' + JSON.stringify(out));
"""

def read():
    js.call("frida_unload", {"package": "com.xd.terraria"})
    time.sleep(0.8)
    js.run(CODE)
    time.sleep(1.8)
    for line in js.log(30).get('lines', []):
        if line.startswith('STATE '):
            return json.loads(line[6:])
    return None

if __name__ == '__main__':
    d = read()
    if not d or not d['players']:
        print("无活跃玩家"); raise SystemExit
    for p in d['players']:
        print(f"槽位{p['slot']}  生命 {p['hp']}/{p['hpMax']} (上限{p['hpMax2']})  魔力 {p['mp']}/{p['mpMax']} (上限{p['mpMax2']})  防御 {p['defense']}")
        print(f"  位置 ({p['x']},{p['y']})  速度 ({p['vx']},{p['vy']})  呼吸 {p['breath']}/{p['breathMax']}  死亡={p['dead']}")
        print(f"  背包({len(p['inv'])}件): " + ", ".join(f"[{x['i']}]id{x['type']}x{x['stack']}" for x in p['inv'][:15]))
        print(f"  装备({len(p['armor'])}件): " + ", ".join(f"[{x['i']}]id{x['type']}" for x in p['armor'][:10]))
