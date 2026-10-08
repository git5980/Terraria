/*
 * ═══════════════════════════════════════════════════════════════════════════
 *  泰拉瑞亚 · 游戏内菜单（JsHook modmenu 官方 schema）
 * ═══════════════════════════════════════════════════════════════════════════
 *  只使用 JsHook 提供的 API：modmenu（ImGui 悬浮菜单）+ 原生 il2cpp 导出。
 *  菜单控件 schema（官方文档）：
 *    {type:'category', title:'分组'}
 *    {type:'switch',   id:'x', title:'开关', val:false}
 *    {type:'button',   id:'x', title:'按钮'}
 *    {type:'slider',   id:'x', title:'滑块', val:50, min:0, max:100}
 *    {type:'checkbox'/'radio'/'select'/'input'/'text'/'image'/'collapse'/'tab', ...}
 *  回调：onchange(result) → result.id 就是控件的 id（务必给每个控件唯一 id）
 *
 *  生命周期铁律：菜单由 JsHook 守护进程绘制，**必须在同一脚本会话里 close()**，
 *  否则会留下关不掉的悬浮图标（closeAll 只能关当前会话的）。
 *  用法：改下面 CFG，然后在 JsHook 里执行本脚本。
 * ═══════════════════════════════════════════════════════════════════════════
 */
var CFG = {
  title: '泰拉瑞亚面板',
  autoCloseSec: 0,      // >0 则 N 秒后自动关闭（测试用，避免留下图标）
  logPrefix: '[菜单]'
};
function log() { console.log(CFG.logPrefix + ' ' + Array.prototype.join.call(arguments, ' ')); }

/* ───────────────────────── il2cpp 工具层 ───────────────────────── */
var IL = (function () {
  var m = Process.findModuleByName('libil2cpp.so');
  if (!m) { log('libil2cpp.so 未加载（游戏没运行？）'); return null; }
  function E(n) { var p = null; try { p = m.findExportByName(n); } catch (e) {} if (!p) { try { p = m.getExportByName(n); } catch (e) {} } return p; }
  function F(n, r, a) { var x = E(n); if (!x) throw new Error('缺少导出 ' + n); return new NativeFunction(x, r, a); }
  var il = {
    domain_get: F('il2cpp_domain_get', 'pointer', []),
    domain_get_assemblies: F('il2cpp_domain_get_assemblies', 'pointer', ['pointer', 'pointer']),
    assembly_get_image: F('il2cpp_assembly_get_image', 'pointer', ['pointer']),
    image_get_name: F('il2cpp_image_get_name', 'pointer', ['pointer']),
    class_from_name: F('il2cpp_class_from_name', 'pointer', ['pointer', 'pointer', 'pointer']),
    class_get_field_from_name: F('il2cpp_class_get_field_from_name', 'pointer', ['pointer', 'pointer']),
    class_get_method_from_name: F('il2cpp_class_get_method_from_name', 'pointer', ['pointer', 'pointer', 'int']),
    field_get_type: F('il2cpp_field_get_type', 'pointer', ['pointer']),
    type_get_name: F('il2cpp_type_get_name', 'pointer', ['pointer']),
    field_get_value: F('il2cpp_field_get_value', 'void', ['pointer', 'pointer', 'pointer']),
    field_set_value: F('il2cpp_field_set_value', 'void', ['pointer', 'pointer', 'pointer']),
    field_static_get_value: F('il2cpp_field_static_get_value', 'void', ['pointer', 'pointer']),
    field_static_set_value: F('il2cpp_field_static_set_value', 'void', ['pointer', 'pointer']),
    runtime_invoke: F('il2cpp_runtime_invoke', 'pointer', ['pointer', 'pointer', 'pointer', 'pointer']),
    string_chars: F('il2cpp_string_chars', 'pointer', ['pointer']),
    string_new: F('il2cpp_string_new', 'pointer', ['pointer']),
    thread_attach: F('il2cpp_thread_attach', 'pointer', ['pointer'])
  };
  function cs(p) { try { return (!p || p.isNull()) ? null : p.readUtf8String(); } catch (e) { return null; } }
  function jstr(p) { if (!p || p.isNull()) return ''; try { var l = p.add(0x10).readS32(); return l <= 0 ? '' : il.string_chars(p).readUtf16String(l); } catch (e) { return ''; } }
  var dom = il.domain_get(); il.thread_attach(dom);
  var sz = Memory.alloc(8), asms = il.domain_get_assemblies(dom, sz), n = sz.readU64().toNumber(), ACS = null;
  for (var i = 0; i < n; i++) {
    var img = il.assembly_get_image(asms.add(i * Process.pointerSize).readPointer());
    if (String(cs(il.image_get_name(img))) === 'Assembly-CSharp.dll') ACS = img;
  }
  if (!ACS) { log('找不到 Assembly-CSharp.dll'); return null; }
  function cls(ns, nm) { return il.class_from_name(ACS, Memory.allocUtf8String(ns), Memory.allocUtf8String(nm)); }
  var Main = cls('Terraria', 'Main'), Player = cls('Terraria', 'Player'), Item = cls('Terraria', 'Item'),
      Lang = cls('Terraria', 'Lang'), Sandstorm = cls('Terraria.GameContent.Events', 'Sandstorm');
  var buf = Memory.alloc(64), exc = Memory.alloc(Process.pointerSize);
  var FC = {}, TC = {};
  function fI(cls_, nm) { return il.class_get_field_from_name(cls_, Memory.allocUtf8String(nm)); }
  function tn(f) { var k = f.toString(); if (!TC[k]) TC[k] = cs(il.type_get_name(il.field_get_type(f))); return TC[k]; }
  function readInto(f, out) {
    il.field_get_value(CUR, f, out);
    switch (tn(f)) {
      case 'System.Int32': return out.readS32();
      case 'System.Single': return Math.round(out.readFloat() * 10000) / 10000;
      case 'System.Boolean': return out.readU8() !== 0;
      case 'System.Byte': return out.readU8();
      case 'System.SByte': return out.readS8();
      case 'System.Int16': return out.readS16();
      case 'System.String': return jstr(out.readPointer());
      default: return undefined;
    }
  }
  var CUR = null;
  function player() {
    il.field_static_get_value(fI(Main, 'player'), buf);
    var arr = buf.readPointer();
    var act = fI(Player, 'active');
    for (var i = 0; i < arr.add(0x18).readS32(); i++) {
      var p = arr.add(0x20 + i * Process.pointerSize).readPointer();
      if (p.isNull()) continue;
      il.field_get_value(p, act, buf);
      if (buf.readU8() !== 0) return p;
    }
    return null;
  }
  function getF(p, nm) {
    var f = fI(Player, nm); if (f.isNull()) return undefined;
    CUR = p; var v = readInto(f, buf); return v;
  }
  function setF(p, nm, v) {
    var f = fI(Player, nm); if (f.isNull()) { log('无字段 Player.' + nm); return false; }
    var t = tn(f), b = Memory.alloc(8);
    if (t === 'System.Single') b.writeFloat(v);
    else if (t === 'System.Boolean') b.writeU8(v ? 1 : 0);
    else if (t === 'System.Byte') b.writeU8(v & 0xff);
    else if (t === 'System.SByte') b.writeS8(v);
    else if (t === 'System.Int16') b.writeS16(v);
    else b.writeS32(v | 0);
    il.field_set_value(p, f, b);
    return true;
  }
  function getS(cls_, nm) { var f = fI(cls_, nm); if (f.isNull()) return undefined; il.field_static_get_value(f, buf); var t = tn(f); return t === 'System.Single' ? buf.readFloat() : (t === 'System.Boolean' ? buf.readU8() !== 0 : buf.readS32()); }
  function setS(cls_, nm, v) {
    var f = fI(cls_, nm); if (f.isNull()) { log('无静态字段 ' + nm); return false; }
    var t = tn(f), b = Memory.alloc(8);
    if (t === 'System.Single') b.writeFloat(v);
    else if (t === 'System.Boolean') b.writeU8(v ? 1 : 0);
    else b.writeS32(v | 0);
    il.field_static_set_value(f, b); return true;
  }
  function call(obj, cls_, nm, args) {
    var mi = il.class_get_method_from_name(cls_, Memory.allocUtf8String(nm), args ? args.length : 0);
    if (mi.isNull()) { log('无方法 ' + nm + '/' + (args ? args.length : 0)); return null; }
    var argv = null;
    if (args && args.length) {
      argv = Memory.alloc(Process.pointerSize * args.length);
      for (var i = 0; i < args.length; i++) argv.add(i * Process.pointerSize).writePointer(args[i]);
    }
    exc.writePointer(ptr(0));
    var r = il.runtime_invoke(mi, obj || NULL, argv, exc);
    return exc.readPointer().isNull() ? r : null;
  }
  function itemName(t) {
    if (t <= 0) return '';
    var a = Memory.alloc(Process.pointerSize), v = Memory.alloc(4); v.writeS32(t); a.writePointer(v);
    exc.writePointer(ptr(0));
    var r = il.runtime_invoke(il.class_get_method_from_name(Lang, Memory.allocUtf8String('GetItemNameValue'), 1), NULL, a, exc);
    return r ? jstr(r) : '';
  }
  function selectedItem(p) {
    il.field_get_value(p, fI(Player, 'inventory'), buf); var inv = buf.readPointer();
    var idx = getF(p, 'lastHotbarItem');
    if (typeof idx !== 'number' || idx < 0 || idx > 58) idx = 0;
    return { slot: idx, item: inv.add(0x20 + idx * Process.pointerSize).readPointer() };
  }
  function intArg(v) { var b = Memory.alloc(4); b.writeS32(v | 0); return b; }
  function boolArg(v) { var b = Memory.alloc(1); b.writeU8(v ? 1 : 0); return b; }
  /* 附加尝试：游戏内聊天提示。注意本移植版 Main.NewText 会抛 NullReferenceException
     （两个重载、主线程/脚本线程都试过），所以它只是「锦上添花」，失败无副作用。 */
  function text(msg, rgba) {
    try {
      var sp = il.string_new(Memory.allocUtf8String(String(msg)));
      var cp = Memory.alloc(4); cp.writeU32(rgba === undefined ? 0xff7ef0a0 : rgba);
      var mi = il.class_get_method_from_name(Main, Memory.allocUtf8String('NewText'), 2);
      if (mi.isNull()) return;
      var argv = Memory.alloc(Process.pointerSize * 2);
      argv.writePointer(sp); argv.add(Process.pointerSize).writePointer(cp);
      exc.writePointer(ptr(0));
      il.runtime_invoke(mi, NULL, argv, exc);
    } catch (e) {}
  }
  return { il: il, ACS: ACS, cls: cls, Main: Main, Player: Player, Item: Item, Sandstorm: Sandstorm,
    player: player, getF: getF, setF: setF, getS: getS, setS: setS, call: call, itemName: itemName,
    selectedItem: selectedItem, intArg: intArg, boolArg: boolArg, text: text,
    /* 菜单回调跑在 JsHook 的 Binder/ImGui 线程上，那个线程没 attach 到 il2cpp，
       runtime_invoke 会踩空（access violation accessing 0x10）→ 每次回调都要重新 attach */
    attach: function () { try { il.thread_attach(dom); } catch (e) {} },
    /* 找 UnityEngine.Input 上某个方法的 methodPointer（面板模式靠它屏蔽输入） */
    inputMethodPtr: function (name, argc) {
      try {
        var sz = Memory.alloc(8), asms = il.domain_get_assemblies(dom, sz);
        var n = sz.readU64().toNumber();
        for (var i = 0; i < n; i++) {
          var img = il.assembly_get_image(asms.add(i * Process.pointerSize).readPointer());
          var nm = String(cs(il.image_get_name(img)));
          if (nm.indexOf('UnityEngine') < 0) continue;
          var k = il.class_from_name(img, Memory.allocUtf8String('UnityEngine'), Memory.allocUtf8String('Input'));
          if (k.isNull()) continue;
          var mi = il.class_get_method_from_name(k, Memory.allocUtf8String(name), argc);
          if (!mi.isNull()) return mi.readPointer();
        }
      } catch (e) { log('找 ' + name + ' 失败 ' + e); }
      return null;
    } };
})();

if (!IL) { log('初始化失败，脚本退出'); }
else {

/* ───────────────────────── 持续效果（ResetEffects Hook） ───────────────────────── */
var STATE = { full: false, god: false, fly: false, speed: false, luck: false };
var hookHandle = null;
var HIT = 0;
function ensureHook() {
  if (hookHandle) return;
  var mi = IL.il.class_get_method_from_name(IL.Player, Memory.allocUtf8String('ResetEffects'), 0);
  if (mi.isNull()) { log('找不到 ResetEffects'); return; }
  hookHandle = Interceptor.attach(mi.readPointer(), {
    onEnter: function (a) { this.p = a[0]; },
    onLeave: function () {
      HIT++;
      var p = this.p;
      if (STATE.full) {
        IL.setF(p, 'statDefense', 100);
        IL.setF(p, 'meleeDamage', 3); IL.setF(p, 'rangedDamage', 3); IL.setF(p, 'magicDamage', 3); IL.setF(p, 'minionDamage', 3);
        IL.setF(p, 'meleeCrit', 100); IL.setF(p, 'rangedCrit', 100); IL.setF(p, 'magicCrit', 100);
        IL.setF(p, 'moveSpeed', 1.8); IL.setF(p, 'maxRunSpeed', 9); IL.setF(p, 'accRunSpeed', 6);
        IL.setF(p, 'wingTime', 200); IL.setF(p, 'wingTimeMax', 200); IL.setF(p, 'endurance', 0.5);
      }
      if (STATE.god) { IL.setF(p, 'statDefense', 200); IL.setF(p, 'endurance', 0.5); IL.setF(p, 'immuneTime', 3600); IL.setF(p, 'lavaImmune', true); }
      if (STATE.fly) { IL.setF(p, 'wingTime', 200); IL.setF(p, 'wingTimeMax', 200); }
      if (STATE.speed) { IL.setF(p, 'moveSpeed', 1.8); IL.setF(p, 'maxRunSpeed', 10); IL.setF(p, 'accRunSpeed', 7); IL.setF(p, 'jumpSpeedBoost', 4); }
      if (STATE.luck) { IL.setF(p, 'luck', 1); }
    }
  });
  say('持续效果钩子已挂载（每帧生效）', 0xff7ec8ff);
  log('已挂 ResetEffects 持续效果钩子');
}
var DEBUFF_IDS = [20,21,22,23,24,25,30,31,32,33,34,35,36,37,38,39,44,46,47,67,68,69,70,80,88,94,103,120,137,144,149,153,156,160,163,169,195,196,203,334,375];

/* 菜单句柄先声明（say() 要用），create 在后面赋值 */
var menu = null;
/* 统一反馈：写菜单状态栏（一定看得见）+ 写日志。游戏内聊天接口在本移植版不可用。 */
function say(msg) {
  msg = String(msg);
  log(msg);
  try { if (menu && menu.update) menu.update('status', msg); } catch (e) { log('状态栏更新失败 ' + e); }
}

/* ───────────────────────── 面板模式（保守版） ─────────────────────────
 * 背景：JsHook 的悬浮菜单是“只读输入”的覆盖层——它读得到触摸，但**从不消费**，
 *       所以点/拖面板时下面的游戏（甚至系统界面）也会收到同一次触摸。
 * 尝试过在 Java 层 Activity.dispatchTouchEvent 直接吞掉触摸：**实测导致游戏闪退**，已放弃。
 * 现在只保留最轻量的做法：钩 UnityEngine.Input.get_touchCount，面板模式下让它返回 0，
 *       游戏就“看不到触摸”了；这只是改一个返回值，不动事件流，风险最低。
 * 注意：它只影响游戏；面板盖在系统界面/其它 App 上时仍然会点穿（框架决定，JS 侧改不了）。
 */
var BLOCK = false, BLOCK_HITS = 0, LAST_MENU_EVENT = Date.now(), INPUT_HOOKS = [];
/* 实测（输入统计）：Unity 把触摸同时映射成鼠标事件，游戏真正读的是 Input.GetMouseButton(0)
 * （每秒约 60 次、触摸时为真）；get_touchCount 只是顺带读。所以这几个都要屏蔽。 */
var INPUT_TARGETS = [
  ['GetMouseButton', 1], ['GetMouseButtonDown', 1], ['GetMouseButtonUp', 1],
  ['get_touchCount', 0], ['get_anyKeyDown', 0]
];
function installInputBlock() {
  if (INPUT_HOOKS.length) return true;
  var okAny = false;
  for (var i = 0; i < INPUT_TARGETS.length; i++) {
    var nm = INPUT_TARGETS[i][0], argc = INPUT_TARGETS[i][1];
    var ptr = IL.inputMethodPtr(nm, argc);
    if (!ptr) { log('跳过（不存在）：Input.' + nm); continue; }
    try {
      INPUT_HOOKS.push(Interceptor.attach(ptr, {
        onLeave: function (ret) { try { if (BLOCK) { BLOCK_HITS++; ret.replace(0); } } catch (e) {} }
      }));
      log('已屏蔽 Input.' + nm);
      okAny = true;
    } catch (e) { log('挂 ' + nm + ' 失败 ' + e); }
  }
  return okAny;
}
function setBlock(on) {
  try {
    if (on) {
      var ok = installInputBlock();
      BLOCK = true;
      LAST_MENU_EVENT = Date.now();
      say(ok ? '面板模式：开（游戏收不到触摸；仅对游戏生效）' : '面板模式开启失败：找不到输入入口');
    } else {
      BLOCK = false;
      for (var i = 0; i < INPUT_HOOKS.length; i++) { try { INPUT_HOOKS[i].detach(); } catch (e) {} }
      INPUT_HOOKS = [];
      say('面板模式：关（游戏恢复响应，累计屏蔽 ' + BLOCK_HITS + ' 帧）');
    }
  } catch (e) { say('面板模式切换失败：' + e); }
}
/* 失效保护：60 秒无面板操作自动关闭 */
setInterval(function () {
  if (BLOCK && Date.now() - LAST_MENU_EVENT > 60000) {
    setBlock(false);
    try { if (menu && menu.update) menu.update('t-block', false); } catch (e) {}
    say('面板模式已自动关闭（60 秒无面板操作）');
  }
}, 5000);

/* ───────────────────────── 动作表（id → 行为） ───────────────────────── */
var ACT = {
  /* 角色 */
  'p-read': function () {
    var p = IL.player(); if (!p) return log('没有活跃角色');
    log('角色：生命 ' + IL.getF(p, 'statLife') + '/' + IL.getF(p, 'statLifeMax2') + '  魔力 ' + IL.getF(p, 'statMana') + '/' + IL.getF(p, 'statManaMax2') +
        '  防御 ' + IL.getF(p, 'statDefense') + '  难度 ' + IL.getF(p, 'difficulty') + '  移速 ' + IL.getF(p, 'moveSpeed'));
  },
  'p-max': function () {
    var p = IL.player(); if (!p) return log('没有活跃角色');
    IL.setF(p, 'statLifeMax', 500); IL.setF(p, 'statLifeMax2', 500); IL.setF(p, 'statLife', 500);
    IL.setF(p, 'statManaMax', 200); IL.setF(p, 'statManaMax2', 200); IL.setF(p, 'statMana', 200);
    STATE.full = true; ensureHook();
    say('满配角色已生效：生命 500 / 魔力 200 + 持续加成', 0xffffd479);
    log('满配已生效（生命/魔力上限 + 持续加成）');
  },
  'p-heal': function () {
    var p = IL.player(); if (!p) return log('没有活跃角色');
    var mx = IL.getF(p, 'statLifeMax2') || 0;
    IL.call(p, IL.Player, 'Heal', [IL.intArg(mx)]);
    say('回满血 +' + mx, 0xff7ef0a0);
    log('回满血 +' + mx);
  },
  'p-clean': function () {
    var p = IL.player(); if (!p) return log('没有活跃角色');
    var bt = Memory.alloc(16); IL.il.field_get_value(p, IL.il.class_get_field_from_name(IL.Player, Memory.allocUtf8String('buffType')), bt);
    var arr = bt.readPointer(); var del = 0;
    if (!arr.isNull()) {
      var len = arr.add(0x18).readS32();
      for (var k = 0; k < len; k++) {
        var id = arr.add(0x20 + k * 4).readS32();
        if (id > 0 && DEBUFF_IDS.indexOf(id) >= 0) { IL.call(p, IL.Player, 'DelBuff', [IL.intArg(k)]); del++; }
      }
    }
    say('已清除减益 ' + del + ' 个', 0xff7ef0a0);
    log('清除减益 ' + del + ' 个');
  },
  'p-classic': function () { var p = IL.player(); if (!p) return; IL.setF(p, 'difficulty', 0); say('难度已改为经典（不再掉物品）'); log('难度改为经典'); },
  'p-journey': function () { var p = IL.player(); if (!p) return; IL.setF(p, 'difficulty', 3); log('难度改为旅途'); },

  /* 持续开关 */
  'c-full': function (v) { STATE.full = !!v; if (v) ensureHook(); say('满配持续加成 ' + (v ? '开' : '关')); log('满配持续加成 ' + (v ? '开' : '关')); },
  'c-god': function (v) { STATE.god = !!v; if (v) ensureHook(); say('上帝模式 ' + (v ? '开' : '关')); log('上帝模式 ' + (v ? '开' : '关')); },
  'c-fly': function (v) { STATE.fly = !!v; if (v) ensureHook(); say('飞行 ' + (v ? '开' : '关')); log('飞行 ' + (v ? '开' : '关')); },
  'c-speed': function (v) { STATE.speed = !!v; if (v) ensureHook(); say('加速跑 ' + (v ? '开' : '关')); log('加速 ' + (v ? '开' : '关')); },
  'c-luck': function (v) { STATE.luck = !!v; if (v) ensureHook(); say('幸运 ' + (v ? '开' : '关')); log('幸运 ' + (v ? '开' : '关')); },

  /* 事件 */
  'e-blood': function (v) { IL.setS(IL.Main, 'bloodMoon', !!v); log('血月 ' + (v ? '开' : '关')); },
  'e-eclipse': function (v) { IL.setS(IL.Main, 'eclipse', !!v); log('日食 ' + (v ? '开' : '关')); },
  'e-rain': function (v) {
    if (v) { IL.call(null, IL.Main, 'StartRain', [IL.boolArg(true), Memory.alloc(8), IL.boolArg(false)]); log('开始下雨'); }
    else { IL.call(null, IL.Main, 'StopRain', [IL.boolArg(true)]); log('停雨'); }
  },
  'e-sand': function (v) {
    if (v) { IL.call(null, IL.Sandstorm, 'StartSandstorm', []); log('沙尘暴开'); }
    else { IL.call(null, IL.Sandstorm, 'StopSandstorm', []); log('沙尘暴停'); }
  },
  'e-goblin': function () { IL.call(null, IL.Main, 'StartInvasion', [IL.intArg(1)]); log('哥布林入侵'); },
  'e-pirate': function () { IL.call(null, IL.Main, 'StartInvasion', [IL.intArg(3)]); log('海盗入侵'); },
  'e-martian': function () { IL.call(null, IL.Main, 'StartInvasion', [IL.intArg(4)]); log('火星暴乱'); },
  'e-stop': function () {
    ['bloodMoon','eclipse','pumpkinMoon','snowMoon'].forEach(function (f) { IL.setS(IL.Main, f, false); });
    IL.setS(IL.Main, 'invasionType', 0); IL.setS(IL.Main, 'invasionSize', 0); IL.setS(IL.Main, 'invasionDelay', 0);
    IL.setS(IL.Sandstorm, 'Happening', false); IL.setS(IL.Sandstorm, 'TimeLeft', 0);
    log('已停止全部事件');
  },
  'e-party': function () { IL.call(null, IL.cls('Terraria.GameContent.Events', 'BirthdayParty'), 'ToggleManualParty', []); log('派对切换'); },
  'e-lantern': function () { IL.call(null, IL.cls('Terraria.GameContent.Events', 'LanternNight'), 'ToggleManualLanterns', []); log('灯笼夜切换'); },

  /* 武器 */
  'w-read': function () {
    var p = IL.player(); if (!p) return;
    var s = IL.selectedItem(p);
    var t = IL.getF(s.item, 'type');
    log('选中槽' + s.slot + '：' + IL.itemName(t) + '(' + t + ') 伤害=' + IL.getF(s.item, 'damage') + ' 暴击=' + IL.getF(s.item, 'crit') +
        ' 使用时间=' + IL.getF(s.item, 'useTime') + ' 弹速=' + IL.getF(s.item, 'shootSpeed') + ' 前缀=' + IL.getF(s.item, 'prefix'));
  },
  'w-dmg': function () {
    var p = IL.player(); if (!p) return;
    var s = IL.selectedItem(p), d = IL.getF(s.item, 'damage') || 0;
    IL.setF(s.item, 'damage', Math.min(d + 50, 99999));
    say('选中武器伤害 ' + d + ' → ' + IL.getF(s.item, 'damage') + '（只改这一把）', 0xffffd479);
    log('选中武器伤害 ' + d + ' → ' + IL.getF(s.item, 'damage') + '（只改这一把）');
  },
  'w-crit': function () { var p = IL.player(); if (!p) return; var s = IL.selectedItem(p); IL.setF(s.item, 'crit', 100); log('选中武器必暴'); },
  'w-fast': function () { var p = IL.player(); if (!p) return; var s = IL.selectedItem(p); IL.setF(s.item, 'useTime', 5); IL.setF(s.item, 'useAnimation', 5); log('选中武器快挥'); },
  'w-revert': function () {
    var p = IL.player(); if (!p) return;
    var s = IL.selectedItem(p), t = IL.getF(s.item, 'type');
    IL.call(s.item, IL.Item, 'SetDefaults', [IL.intArg(t), IL.boolArg(false)]);
    log('选中武器已恢复原厂（' + IL.itemName(t) + '）');
  },
  'info': function () { say('状态 ' + JSON.stringify(STATE) + ' 钩子命中 ' + HIT + ' 触摸拦截 ' + BLOCK_HITS); },
  't-block': function (v) { setBlock(!!v); }
};

/* ───────────────────────── 菜单（官方 schema：title / val / id） ───────────────────────── */
var OPTIONS = [
  { type: 'text', val: '泰拉瑞亚面板 · JsHook modmenu', size: 40, color: '#FFD479' },
  { type: 'text', id: 'status', val: '就绪（点下面按钮）', size: 34, color: '#7EC8FF' },
  { type: 'switch', id: 't-block', title: '面板模式：游戏收不到触摸（仅对游戏生效）', val: false },

  { type: 'collapse', title: '角色', default: true, item: [
    { type: 'button', id: 'p-read',    title: '读属性(日志)' },
    { type: 'button', id: 'p-max',     title: '满配角色' },
    { type: 'button', id: 'p-heal',    title: '回满血' },
    { type: 'button', id: 'p-clean',   title: '清减益' },
    { type: 'button', id: 'p-classic', title: '改经典难度' },
    { type: 'switch', id: 'c-full',  title: '持续加成(防御/伤害/暴击/翅膀)', val: false },
    { type: 'switch', id: 'c-god',   title: '上帝模式', val: false },
    { type: 'switch', id: 'c-fly',   title: '飞行', val: false },
    { type: 'switch', id: 'c-speed', title: '加速跑', val: false },
    { type: 'switch', id: 'c-luck',  title: '幸运拉满', val: false }
  ] },

  { type: 'collapse', title: '事件', default: false, item: [
    { type: 'switch', id: 'e-blood',   title: '血月', val: false },
    { type: 'switch', id: 'e-eclipse', title: '日食', val: false },
    { type: 'switch', id: 'e-rain',    title: '下雨', val: false },
    { type: 'switch', id: 'e-sand',    title: '沙尘暴', val: false },
    { type: 'button', id: 'e-goblin',  title: '哥布林入侵' },
    { type: 'button', id: 'e-pirate',  title: '海盗入侵' },
    { type: 'button', id: 'e-martian', title: '火星暴乱' },
    { type: 'button', id: 'e-party',   title: '派对切换' },
    { type: 'button', id: 'e-lantern', title: '灯笼夜切换' },
    { type: 'button', id: 'e-stop',    title: '⚠ 停止全部事件' }
  ] },

  { type: 'collapse', title: '武器（只改当前选中的那一把）', default: false, item: [
    { type: 'button', id: 'w-read',   title: '读当前选中武器' },
    { type: 'button', id: 'w-dmg',    title: '伤害 +50' },
    { type: 'button', id: 'w-crit',   title: '必暴' },
    { type: 'button', id: 'w-fast',   title: '快挥' },
    { type: 'button', id: 'w-revert', title: '恢复原厂' }
  ] },

  { type: 'collapse', title: '其它', default: false, item: [
    { type: 'button', id: 'info', title: '打印内部状态到日志' }
  ] }
];

/* 自清理：关掉上一次运行遗留的菜单（句柄挂在 globalThis 上，跨脚本会话仍在），避免叠出多个图标 */
try {
  if (globalThis.TERRARIA_MENU && globalThis.TERRARIA_MENU.close) {
    globalThis.TERRARIA_MENU.close();
    log('已关闭上一次的菜单');
  }
} catch (e) { log('关闭旧菜单失败：' + e); }

menu = modmenu.create(CFG.title, OPTIONS, {
  onchange: function (res) {
    try {
      IL.attach();                       // ← 关键：回调线程必须重新 attach il2cpp
      LAST_MENU_EVENT = Date.now();      // 供面板模式失效保护使用
      log('onchange ' + JSON.stringify(res));
      var id = res && res.id;
      var val = res && (res.val !== undefined ? res.val : res.value);
      if (!id) { log('控件没有 id，忽略（请给控件加唯一 id）'); return; }
      var fn = ACT[id];
      if (!fn) {
        /* status 是我们自己用 menu.update() 写回显的控件，update 会反过来触发 onchange，
           必须忽略它，否则会形成回显循环 */
        if (id !== 'status') log('未知控件 id：' + id);
        return;
      }
      fn(val);
    } catch (e) { log('处理菜单事件出错：' + e); }
  }
});
log('菜单已创建：' + CFG.title + '（控件 ' + OPTIONS.length + ' 组）');

if (CFG.autoCloseSec > 0) {
  setTimeout(function () { try { menu.close(); log('已自动关闭菜单'); } catch (e) {} }, CFG.autoCloseSec * 1000);
}

/* 对外句柄：同一会话里可以 menu.close() / menu.update('c-god', true) */
globalThis.TERRARIA_MENU = menu;
globalThis.TERRARIA_MENU_ACT = ACT;
}
