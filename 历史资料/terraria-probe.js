// 泰拉瑞亚 (com.xd.terraria) 只读探针 —— 读背包 + 中文物品名 + 弹药判定
// 用法：通过 JsHook MCP 的 frida_execute 执行；执行前需先 frida_unload
// 全程只读，不写内存。
//
// 输出以 [P] 前缀打到 console.log，用 frida_read_log 读取。

function P(s){ console.log('[P] ' + s); }
function safe(fn, d){ try { return fn(); } catch(e){ return d; } }

// ── 1. 解析 il2cpp 导出 ────────────────────────────────────────────────
var m = Process.findModuleByName('libil2cpp.so');
function NF(n, ret, args){
  var q = null;
  try { q = m.findExportByName(n); } catch(e){}
  return q === null ? null : new NativeFunction(q, ret, args);
}
var NG   = NF('il2cpp_domain_get',            'pointer', []);
var DAO  = NF('il2cpp_domain_assembly_open',  'pointer', ['pointer','pointer']);
var AGI  = NF('il2cpp_assembly_get_image',    'pointer', ['pointer']);
var CFN  = NF('il2cpp_class_from_name',       'pointer', ['pointer','pointer','pointer']);
var CGF  = NF('il2cpp_class_get_field_from_name','pointer', ['pointer','pointer']);
var FOF  = NF('il2cpp_field_get_offset',      'int',     ['pointer']);
var FSG  = NF('il2cpp_field_static_get_value','void',    ['pointer','pointer']);
var S    = function(x){ return Memory.allocUtf8String(x); };

// ── 2. 物品名表：Terraria.Lang._itemNameCache 是 LocalizedText[]，索引 = 物品 ID ──
var img = AGI(DAO(NG(), S('Assembly-CSharp')));
var o   = Memory.alloc(32);
FSG(CGF(CFN(img, S('Terraria'), S('Lang')), S('_itemNameCache')), o);
var namEl = o.readPointer().add(0x20);

function nameOf(id){
  if (id <= 0) return '-';
  try {
    var lt = namEl.add(id * 8).readPointer();     // LocalizedText*
    if (lt.isNull()) return '#' + id;
    var sp = lt.add(0x18).readPointer();          // +0x10=Key, +0x18=本地化值
    if (sp.isNull()) return '#' + id;
    var n = sp.add(0x10).readS32();               // Il2CppString.length
    if (n <= 0 || n > 160) return '#' + id;
    return sp.add(0x14).readUtf16String(n);
  } catch(e){ return '#' + id; }
}

// ── 3. 取当前玩家与背包 ───────────────────────────────────────────────
var clsMain   = CFN(img, S('Terraria'), S('Main'));
var clsPlayer = CFN(img, S('Terraria'), S('Player'));
var ob = Memory.alloc(16);
FSG(CGF(clsMain, S('player')), ob);
var p0  = ob.readPointer().add(0x20).readPointer();            // Player[0]
var inv = p0.add(FOF(CGF(clsPlayer, S('inventory')))).readPointer();  // Item[]
var len = inv.add(0x18).readS32();                              // 59
var el  = inv.add(0x20);

// Item 字段偏移（实测）：type@76 stack@96 damage@132 ammo@256 useAmmo@264 prefix@344(void) ranged@347
var items = [], have = {};
for (var j = 0; j < len; j++){
  var it = el.add(j * 8).readPointer();
  if (it.isNull()) continue;
  var t = it.add(76).readS32();
  if (t <= 0) continue;
  var rec = {
    slot:    j,
    type:    t,
    name:    nameOf(t),
    stack:   it.add(96).readS32(),
    damage:  it.add(132).readS32(),
    ammo:    it.add(256).readS32(),
    useAmmo: it.add(264).readS32(),
    prefix:  it.add(344).readU8(),   // 单字节！
    ranged:  it.add(347).readU8()
  };
  items.push(rec);
  if (rec.ammo > 0) have[rec.ammo] = 1;
}

// ── 4. 输出 ───────────────────────────────────────────────────────────
P('背包物品数=' + items.length + '  已有弹药类别=' + Object.keys(have).join(','));
for (var k = 0; k < items.length; k++){
  var x = items[k];
  var verdict = x.useAmmo > 0 ? (have[x.useAmmo] ? '有弹药' : '**无弹药**') : '-';
  P('slot' + x.slot + ' | ' + x.name + ' x' + x.stack
    + ' | dmg=' + x.damage + ' ranged=' + x.ranged + ' prefix=' + x.prefix
    + ' | 需要:' + (x.useAmmo > 0 ? nameOf(x.useAmmo) + '#' + x.useAmmo : '无')
    + ' | ' + verdict);
}

// 只列出"无弹药的武器"
var noAmmo = [];
for (var q = 0; q < items.length; q++){
  var y = items[q];
  if (y.useAmmo > 0 && !have[y.useAmmo]) noAmmo.push('slot' + y.slot + ' ' + y.name);
}
P('无弹药武器(' + noAmmo.length + ')=' + noAmmo.join(' , '));
P('END');
