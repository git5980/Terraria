/*
 * ============================================================================
 *  泰拉瑞亚（国服 com.xd.terraria）武器/装备强化脚本 —— 只改「我手里这一把」
 * ============================================================================
 *  原理（为什么只对这一把生效）：
 *    泰拉瑞亚的物品属性（伤害/暴击/使用时间…）保存在 **Item 实例** 上，不在物品类型上。
 *    背包每个格子是一个独立的 Item 对象：改 inventory[选中格] 那个对象的字段，
 *    只影响这一格；同类型的其它副本、以及以后打造/购买/掉落的同类武器都是新对象，
 *    它们走 Item.SetDefaults(type) 拿到原厂数值 —— 所以永远是原值。
 *
 *  当前选中武器怎么认：
 *    实测本移植版没有 Player.selectedItem 字段（它是属性，返回值不可靠），
 *    但 **Player.lastHotbarItem**(int) 就是当前选中的热键栏序号 →
 *    inventory[lastHotbarItem] 就是手里的物品。脚本还会打印整条热键栏供你核对。
 *
 *  安全：CONFIG.enabled 默认 false —— 只读（只显示属性，不改任何东西）。
 * ============================================================================
 */
var CONFIG = {
  enabled: false,          // ← 总开关：false = 只读
  target: "selected",      // "selected" = 当前选中格；"slot" = 用下面 slot 指定
  slot: 0,                 // target="slot" 时使用（0-9 热键栏，0-58 全部背包）
  onlyWeapons: true,       // 目标不是武器（damage<=0）时只提示、不修改
  revert: false,           // true = 把该物品恢复为原厂数值（SetDefaults，保留堆叠与部分前缀）

  // 要施加的修改（null / 0 / 1 表示不改那一项）
  mods: {
    damageAdd: 0,          // 伤害加值（先加）
    damageMul: 1,          // 伤害倍率（后乘），1 = 不变
    crit: null,            // 暴击率 %（原版 4）
    useTime: null,         // 使用时间（帧，越小挥得越快）
    useAnimation: null,    // 动画帧
    knockBack: null,       // 击退（小数）
    shootSpeed: null,      // 弹速（小数）
    autoReuse: null,       // 自动挥舞 true/false
    rare: null,            // 稀有度颜色值（0 白 1 蓝 … 10 红）
    value: null,           // 售价（铜币）
    scale: null,           // 外观缩放（小数）
    mana: null             // 魔力消耗
  },
  maxDamage: 99999         // 伤害安全上限，防止写爆
};

(function () {
  // ══════════════════════════════════════ il2cpp 引导
  var m = Process.findModuleByName("libil2cpp.so");
  if (!m) { console.log("[!] libil2cpp.so 未加载"); return; }
  function E(n) { var p = null; try { p = m.findExportByName(n); } catch (e) {} if (!p) { try { p = m.getExportByName(n); } catch (e) {} } return p; }
  function F(n, r, a) { var x = E(n); if (!x) throw new Error("缺少导出 " + n); return new NativeFunction(x, r, a); }
  var il = {
    domain_get: F("il2cpp_domain_get", "pointer", []),
    domain_get_assemblies: F("il2cpp_domain_get_assemblies", "pointer", ["pointer", "pointer"]),
    assembly_get_image: F("il2cpp_assembly_get_image", "pointer", ["pointer"]),
    image_get_name: F("il2cpp_image_get_name", "pointer", ["pointer"]),
    class_from_name: F("il2cpp_class_from_name", "pointer", ["pointer", "pointer", "pointer"]),
    class_get_field_from_name: F("il2cpp_class_get_field_from_name", "pointer", ["pointer", "pointer"]),
    class_get_method_from_name: F("il2cpp_class_get_method_from_name", "pointer", ["pointer", "pointer", "int"]),
    field_get_type: F("il2cpp_field_get_type", "pointer", ["pointer"]),
    type_get_name: F("il2cpp_type_get_name", "pointer", ["pointer"]),
    field_get_value: F("il2cpp_field_get_value", "void", ["pointer", "pointer", "pointer"]),
    field_set_value: F("il2cpp_field_set_value", "void", ["pointer", "pointer", "pointer"]),
    field_static_get_value: F("il2cpp_field_static_get_value", "void", ["pointer", "pointer"]),
    object_new: F("il2cpp_object_new", "pointer", ["pointer"]),
    runtime_invoke: F("il2cpp_runtime_invoke", "pointer", ["pointer", "pointer", "pointer", "pointer"]),
    string_chars: F("il2cpp_string_chars", "pointer", ["pointer"]),
    thread_attach: F("il2cpp_thread_attach", "pointer", ["pointer"])
  };
  function cs(p) { try { return (!p || p.isNull()) ? null : p.readUtf8String(); } catch (e) { return null; } }
  function jstr(p) { if (!p || p.isNull()) return ""; try { var l = p.add(0x10).readS32(); return l <= 0 ? "" : il.string_chars(p).readUtf16String(l); } catch (e) { return ""; } }
  var dom = il.domain_get(); il.thread_attach(dom);
  var szP = Memory.alloc(8), asms = il.domain_get_assemblies(dom, szP);
  var nAsm = szP.readU64().toNumber(), ACS = null;
  for (var i = 0; i < nAsm; i++) {
    var img = il.assembly_get_image(asms.add(i * Process.pointerSize).readPointer());
    if (String(cs(il.image_get_name(img))) === "Assembly-CSharp.dll") ACS = img;
  }
  if (!ACS) { console.log("[!] 找不到 Assembly-CSharp.dll"); return; }
  function cls(ns, nm) { return il.class_from_name(ACS, Memory.allocUtf8String(ns), Memory.allocUtf8String(nm)); }
  var Main = cls("Terraria", "Main"), Player = cls("Terraria", "Player"), ItemC = cls("Terraria", "Item"), Lang = cls("Terraria", "Lang");

  var buf = Memory.alloc(64), exc = Memory.alloc(Process.pointerSize);
  // ══════════════════════════════════════ 本地玩家（get_LocalPlayer 会抛异常，直接扫 active 最稳）
  il.field_static_get_value(il.class_get_field_from_name(Main, Memory.allocUtf8String("player")), buf);
  var pArr = buf.readPointer(), player = null, pIndex = -1;
  var fActive = il.class_get_field_from_name(Player, Memory.allocUtf8String("active"));
  for (var s = 0; s < pArr.add(0x18).readS32(); s++) {
    var pp = pArr.add(0x20 + s * Process.pointerSize).readPointer(); if (pp.isNull()) continue;
    il.field_get_value(pp, fActive, buf);
    if (buf.readU8() !== 0) { player = pp; pIndex = s; break; }
  }
  if (!player) { console.log("[!] 没有活跃玩家（先在游戏里进入一个世界再运行）"); return; }

  // ══════════════════════════════════════ 物品字段读写
  var FC = {}, TC = {};
  function fieldOf(nm) { if (!FC[nm]) FC[nm] = il.class_get_field_from_name(ItemC, Memory.allocUtf8String(nm)); return FC[nm]; }
  function typeOf(f) { var k = f.toString(); if (!TC[k]) TC[k] = cs(il.type_get_name(il.field_get_type(f))); return TC[k]; }
  function getI(it, nm) {
    var f = fieldOf(nm); if (f.isNull()) return undefined;
    il.field_get_value(it, f, buf);
    var t = typeOf(f);
    if (t === "System.Int32") return buf.readS32();
    if (t === "System.Single") return Math.round(buf.readFloat() * 10000) / 10000;
    if (t === "System.Boolean") return buf.readU8() !== 0;
    if (t === "System.Byte") return buf.readU8();
    if (t === "System.SByte") return buf.readS8();
    if (t === "System.Int16") return buf.readS16();
    return undefined;
  }
  function setI(it, nm, v) {
    var f = fieldOf(nm); if (f.isNull()) { console.log("    [!] 无字段 " + nm); return false; }
    var t = typeOf(f), b = Memory.alloc(8);
    if (t === "System.Single") b.writeFloat(v);
    else if (t === "System.Boolean") b.writeU8(v ? 1 : 0);
    else if (t === "System.Byte") b.writeU8(v & 0xff);
    else if (t === "System.SByte") b.writeS8(v);
    else if (t === "System.Int16") b.writeS16(v);
    else if (t === "System.Int32") b.writeS32(v | 0);
    else { console.log("    [!] 不支持的类型 " + nm + ":" + t); return false; }
    il.field_set_value(it, f, b);
    return true;
  }
  var nameM = il.class_get_method_from_name(Lang, Memory.allocUtf8String("GetItemNameValue"), 1);
  function itemName(t) {
    if (t <= 0) return "";
    var a = Memory.alloc(Process.pointerSize), v = Memory.alloc(4); v.writeS32(t); a.writePointer(v);
    exc.writePointer(ptr(0));
    var r = il.runtime_invoke(nameM, NULL, a, exc);
    return r ? jstr(r) : "";
  }
  // argList = 指向各参数的指针数组，如 [intArg(3507), boolArg(false)]
  function callOnItem(it, method, argList) {
    var argc = argList ? argList.length : 0;
    var mi = il.class_get_method_from_name(ItemC, Memory.allocUtf8String(method), argc);
    if (mi.isNull()) { console.log("    [!] Item." + method + "/" + argc + " 不存在"); return null; }
    var argv = null;
    if (argc) {
      argv = Memory.alloc(Process.pointerSize * argc);
      for (var i = 0; i < argc; i++) argv.add(i * Process.pointerSize).writePointer(argList[i]);
    }
    exc.writePointer(ptr(0));
    var r = il.runtime_invoke(mi, it, argv, exc);
    return exc.readPointer().isNull() ? r : null;
  }
  function intArg(v) { var b = Memory.alloc(4); b.writeS32(v | 0); return b; }
  function boolArg(v) { var b = Memory.alloc(1); b.writeU8(v ? 1 : 0); return b; }

  // ══════════════════════════════════════ 定位「当前选中」的物品
  var invField = il.class_get_field_from_name(Player, Memory.allocUtf8String("inventory"));
  il.field_get_value(player, invField, buf); var inv = buf.readPointer();
  function invAt(i) { return inv.add(0x20 + i * Process.pointerSize).readPointer(); }

  // Player 自己的字段要用 Player 的 FieldInfo 查，不能走 getI（那是 Item 的字段表）
  var PF = {};
  function fieldOfP(nm) { if (!PF[nm]) PF[nm] = il.class_get_field_from_name(Player, Memory.allocUtf8String(nm)); return PF[nm]; }
  function getP(nm) {
    var f = fieldOfP(nm); if (f.isNull()) return undefined;
    il.field_get_value(player, f, buf);
    var t = cs(il.type_get_name(il.field_get_type(f)));
    if (t === "System.Int32") return buf.readS32();
    if (t === "System.Boolean") return buf.readU8() !== 0;
    if (t === "System.Byte") return buf.readU8();
    return undefined;
  }
  var lastHot = getP("lastHotbarItem");   // 实测这是本移植版可靠的「当前选中热键栏序号」
  var slot;
  if (CONFIG.target === "slot") slot = CONFIG.slot | 0;
  else slot = (typeof lastHot === "number" && lastHot >= 0 && lastHot <= 58) ? lastHot : 0;
  var item = invAt(slot);

  console.log("=== 角色 #" + pIndex + " 的背包（热键栏 0-9）===");
  var hotInfo = [];
  for (var h = 0; h < 10; h++) {
    var it0 = invAt(h);
    var t0 = it0.isNull() ? 0 : getI(it0, "type");
    hotInfo.push("槽" + h + (h === slot ? "★" : "") + "=" + (t0 > 0 ? (itemName(t0) + "(" + t0 + ")") : "空"));
  }
  console.log("  " + hotInfo.join("  "));
  console.log("[选中判定] lastHotbarItem=" + lastHot + " → 使用槽位 " + slot +
    (CONFIG.target === "slot" ? "（手动指定）" : "（自动）"));
  console.log("    请核对上面带★的槽位是否就是你在游戏里选中的那把；不对就把 CONFIG.target 改成 \"slot\" 并指定 slot。");
  if (item.isNull() || item.equals(ptr(0))) { console.log("[!] 该槽位没有物品实例"); return; }

  var TYPE = getI(item, "type");
  var STAT = ["damage", "knockBack", "crit", "useTime", "useAnimation", "shoot", "shootSpeed", "rare", "value",
    "autoReuse", "scale", "mana", "defense", "ammo", "useAmmo", "stack", "prefix"];
  function snap(it) { var o = {}; for (var i = 0; i < STAT.length; i++) o[STAT[i]] = getI(it, STAT[i]); return o; }
  function show(label, o) {
    console.log("  " + label + " 伤害=" + o.damage + " 击退=" + o.knockBack + " 暴击=" + o.crit + "%" +
      " 使用时间=" + o.useTime + " 动画=" + o.useAnimation + " 弹幕=" + o.shoot + " 弹速=" + o.shootSpeed +
      " 稀有度=" + o.rare + " 售价=" + o.value + " 自动挥舞=" + o.autoReuse + " 缩放=" + o.scale +
      " 魔力=" + o.mana + " 堆叠=" + o.stack + " 前缀=" + o.prefix);
  }
  var isWeapon = (getI(item, "damage") || 0) > 0;
  console.log("=== 目标物品：槽" + slot + "  type=" + TYPE + "  " + itemName(TYPE) + (isWeapon ? "  [武器]" : "  [非武器]") + " ===");
  var before = snap(item);
  show("修改前：", before);

  // 其它同类副本（用来证明「只改这一把」）
  function sameTypeSlots() {
    var out = [];
    for (var i = 0; i < 59; i++) {
      if (i === slot) continue;
      var x = invAt(i); if (x.isNull()) continue;
      if (getI(x, "type") === TYPE) out.push({ slot: i, damage: getI(x, "damage"), stack: getI(x, "stack") });
    }
    return out;
  }
  var copiesBefore = sameTypeSlots();
  console.log("  同类型副本（应保持原值）：" + (copiesBefore.length ? JSON.stringify(copiesBefore) : "无"));
  // 造一个「全新的同类武器」来模拟以后打造/掉落的同款：走 Item.SetDefaults，拿到的必然是原厂数值
  function freshSameType() {
    var ni = il.object_new ? il.object_new(ItemC) : null;
    if (!ni || ni.isNull()) return null;
    callOnItem(ni, "SetDefaults", [intArg(TYPE), boolArg(false)]);
    return { damage: getI(ni, "damage"), crit: getI(ni, "crit"), useTime: getI(ni, "useTime"), rare: getI(ni, "rare"), prefix: getI(ni, "prefix") };
  }

  if (!CONFIG.enabled) {
    console.log("[*] enabled=false —— 只读模式，未做任何修改。");
    console.log("    要修改：设 CONFIG.enabled=true，并按需填 CONFIG.mods（如 damageAdd:50 / damageMul:2 / crit:100）。");
    globalThis.WEAPON = { item: item, slot: slot, type: TYPE, origin: before, snapshot: function () { return snap(item); }, set: function (f, v) { return setI(item, f, v); } };
    return;
  }

  // ══════════════════════════════════════ 恢复原厂数值
  if (CONFIG.revert) {
    var W = globalThis.WEAPON;
    if (W && W.origin && W.slot === slot) {
      // 本次会话里有精确快照 → 逐字段还原（最稳，连前缀效果都原样）
      for (var rk in W.origin) setI(item, rk, W.origin[rk]);
      console.log("=== 已按本次会话快照精确还原 ===");
    } else {
      // 没有快照 → 回到原厂数值，再把原前缀挂回去
      var keepStack = getI(item, "stack"), keepPrefix = getI(item, "prefix");
      var ok = callOnItem(item, "SetDefaults", [intArg(TYPE), boolArg(false)]);
      if (ok === null) console.log("  [!] SetDefaults(int,bool) 调用失败");
      if (keepStack > 1) setI(item, "stack", keepStack);
      if (keepPrefix > 0) {
        callOnItem(item, "Prefix", [intArg(keepPrefix)]);
        console.log("  （已重挂前缀 " + keepPrefix + "；若与原值有细微差异，属前缀重算的已知现象）");
      }
      console.log("=== 已恢复原厂数值 ===");
    }
    show("恢复后：", snap(item));
    globalThis.WEAPON = { item: item, slot: slot, type: TYPE, origin: before, snapshot: function () { return snap(item); }, set: function (f, v) { return setI(item, f, v); } };
    return;
  }

  // ══════════════════════════════════════ 施加修改（只写这一个 Item 实例）
  if (CONFIG.onlyWeapons && !isWeapon) {
    console.log("[!] 目标不是武器（damage<=0），按 onlyWeapons 设置跳过修改。");
  } else {
    var M = CONFIG.mods || {};
    var dmg0 = getI(item, "damage") || 0;
    if (M.damageAdd || (M.damageMul && M.damageMul !== 1)) {
      var nd = Math.round((dmg0 + (M.damageAdd || 0)) * (M.damageMul || 1));
      if (nd > CONFIG.maxDamage) nd = CONFIG.maxDamage;
      if (nd < 0) nd = 0;
      setI(item, "damage", nd);
      console.log("    [改] damage: " + dmg0 + " → " + nd);
    }
    var PAIRS = [["crit", "crit"], ["useTime", "useTime"], ["useAnimation", "useAnimation"], ["knockBack", "knockBack"],
      ["shootSpeed", "shootSpeed"], ["autoReuse", "autoReuse"], ["rare", "rare"], ["value", "value"],
      ["scale", "scale"], ["mana", "mana"]];
    for (var pi = 0; pi < PAIRS.length; pi++) {
      var key = PAIRS[pi][0], fld = PAIRS[pi][1];
      if (M[key] === null || M[key] === undefined) continue;
      var old = getI(item, fld);
      setI(item, fld, M[key]);
      console.log("    [改] " + fld + ": " + old + " → " + getI(item, fld));
    }
    console.log("=== 修改后 ===");
    show("修改后：", snap(item));
  }

  // ══════════════════════════════════════ 作用域验证
  var copiesAfter = sameTypeSlots();
  console.log("=== 作用域验证（同类型其它副本）===");
  console.log("  修改前：" + (copiesBefore.length ? JSON.stringify(copiesBefore) : "无"));
  console.log("  修改后：" + (copiesAfter.length ? JSON.stringify(copiesAfter) : "无"));
  var same = JSON.stringify(copiesBefore) === JSON.stringify(copiesAfter);
  console.log("  → " + (same ? "现有其它副本未受影响 ✓" : "⚠ 其它副本也变了，请检查"));
  var fresh = freshSameType();
  console.log("  新造一把同类武器（模拟以后打造/掉落）→ " + (fresh ? JSON.stringify(fresh) : "创建失败"));
  if (fresh) {
    console.log("  对比：手里这把 伤害=" + getI(item, "damage") + " ；新造的 伤害=" + fresh.damage +
      " → " + (fresh.damage !== getI(item, "damage") ? "新武器保持原厂数值 ✓" : "两者相同（本次修改未改伤害或已恢复）"));
  }

  globalThis.WEAPON = {
    item: item, slot: slot, type: TYPE, origin: before,
    snapshot: function () { return snap(item); },
    set: function (f, v) { return setI(item, f, v); },
    restore: function (o) { for (var k in o) setI(item, k, o[k]); console.log("[*] 已按快照还原"); show("还原后：", snap(item)); },
    copies: sameTypeSlots
  };
  console.log("[*] globalThis.WEAPON 可用：WEAPON.snapshot() / WEAPON.restore(快照) / WEAPON.set('damage',999) / WEAPON.copies()");
})();
