/*
 * ============================================================================
 *  泰拉瑞亚（国服 com.xd.terraria）角色操作脚本 v2 —— 通用版
 * ============================================================================
 *  设计目标：不绑定任何具体角色。任何时候（含以后新创建的角色）都能定位并修改。
 *
 *  定位方式（CONFIG.target）：
 *     "local"          当前本地玩家（走 Main.get_LocalPlayer 属性，单机/联机都对）
 *     "all"            本局所有活跃角色（联机时=所有玩家）
 *     "name:偶泥考"     按角色名精确匹配（找不到会退回包含匹配）
 *     "slot:0"         按玩家槽位
 *
 *  配置来源（二选一或叠加）：
 *     1) CONFIG.profile = "满配角色"  → 运行时代码会去 profilesUrl 拉 profiles.json
 *     2) 直接内联 CONFIG.persistent / CONFIG.continuous / CONFIG.actions（优先级更高）
 *
 *  安全：CONFIG.enabled 默认 false —— 只读。要写入必须先改成 true。
 *
 *  字段两类（重要）：
 *     persistent —— 基础字段，写一次就留住（statLifeMax / statLife / statManaMax / difficulty …）
 *     continuous —— 每帧被 Player.ResetEffects() 重算的字段，必须靠 Hook 持续压住
 *                   （statDefense / 伤害倍率 / 暴击 / moveSpeed / wingTimeMax / luck / immuneTime …）
 *   实测 ResetEffects 每秒 60 次，且**每个角色各调用一次**，本脚本只对选中的角色重写。
 * ============================================================================
 */
var CONFIG = {
  enabled: false,              // ← 总开关：false = 只读，不改任何数据
  scan: true,                  // 打印所有角色（含刚建的）
  target: "local",             // local | all | "name:角色名" | "slot:0"
  profile: "",                 // 从 profiles.json 取哪套配置，留空则只用下面的内联配置
  profilesUrl: "http://127.0.0.1:8791/profiles.json",

  // 内联配置（优先级高于 profile）
  persistent: {
    // statLifeMax: 500, statLifeMax2: 500, statLife: 500,
    // statManaMax: 200, statManaMax2: 200, statMana: 200,
    // difficulty: 0,            // 0 经典 / 1 中核 / 2 硬核 / 3 旅途
    // breath: 200,
  },
  continuous: {
    // statDefense: 100,
    // meleeDamage: 3, rangedDamage: 3, magicDamage: 3, minionDamage: 3,
    // meleeCrit: 100, rangedCrit: 100, magicCrit: 100,
    // moveSpeed: 1.8, maxRunSpeed: 9, accRunSpeed: 6, jumpSpeedBoost: 4,
    // wingTime: 200, wingTimeMax: 200,
    // luck: 1, endurance: 0.5,
    // immuneTime: 3600, onHitDodge: true, lavaImmune: true,
  },
  actions: {
    heal: 0,                   // >0 治这么多；-1 = 回满
    buffs: [],                 // [{type:1,time:36000}]  增益 ID 见 buff_ids.json
    clearDebuffs: false,
    clearAllBuffs: false,
    teleport: null,            // {x:1000,y:500}  只对选中的第一个角色执行
    spawn: [],                 // [{type:4956,stack:1}] 掉在脚下
    toInventory: []            // [{slot:20,type:4956,stack:1}]
  }
};

// 常见减益 ID（由本版本 Terraria.ID.BuffID 常量表筛出）
var DEBUFF_IDS = [20, 21, 22, 23, 24, 25, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 44, 46, 47,
  67, 68, 69, 70, 80, 88, 94, 103, 120, 137, 144, 149, 153, 156, 160, 163, 169, 195, 196, 203, 334, 375];

(function () {
  // ══════════════════════════════════════════════════ il2cpp 引导
  var m = Process.findModuleByName("libil2cpp.so");
  if (!m) { console.log("[!] libil2cpp.so 未加载（游戏没在运行？）"); return; }
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
    field_get_name: F("il2cpp_field_get_name", "pointer", ["pointer"]),
    field_get_type: F("il2cpp_field_get_type", "pointer", ["pointer"]),
    type_get_name: F("il2cpp_type_get_name", "pointer", ["pointer"]),
    field_get_value: F("il2cpp_field_get_value", "void", ["pointer", "pointer", "pointer"]),
    field_set_value: F("il2cpp_field_set_value", "void", ["pointer", "pointer", "pointer"]),
    field_static_get_value: F("il2cpp_field_static_get_value", "void", ["pointer", "pointer"]),
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
  var Main = cls("Terraria", "Main"), Player = cls("Terraria", "Player"), ItemC = cls("Terraria", "Item");

  // ══════════════════════════════════════════════════ 基础工具
  var exc = Memory.alloc(Process.pointerSize), buf = Memory.alloc(64);
  function callStatic(klass, name, argc, argPtrs) {
    var mi = il.class_get_method_from_name(klass, Memory.allocUtf8String(name), argc);
    if (mi.isNull()) return null;
    var argv = null;
    if (argPtrs && argPtrs.length) {
      argv = Memory.alloc(Process.pointerSize * argPtrs.length);
      for (var i = 0; i < argPtrs.length; i++) argv.add(i * Process.pointerSize).writePointer(argPtrs[i]);
    }
    exc.writePointer(ptr(0));
    var r = il.runtime_invoke(mi, NULL, argv, exc);
    return exc.readPointer().isNull() ? r : null;
  }
  function callOn(obj, name, argc, argPtrs) {
    var mi = il.class_get_method_from_name(Player, Memory.allocUtf8String(name), argc);
    if (mi.isNull()) return null;
    var argv = null;
    if (argPtrs && argPtrs.length) {
      argv = Memory.alloc(Process.pointerSize * argPtrs.length);
      for (var i = 0; i < argPtrs.length; i++) argv.add(i * Process.pointerSize).writePointer(argPtrs[i]);
    }
    exc.writePointer(ptr(0));
    var r = il.runtime_invoke(mi, obj, argv, exc);
    return exc.readPointer().isNull() ? r : null;
  }
  function intArg(v) { var b = Memory.alloc(4); b.writeS32(v | 0); return b; }
  function boolArg(v) { var b = Memory.alloc(1); b.writeU8(v ? 1 : 0); return b; }
  function vec2Arg(x, y) { var b = Memory.alloc(8); b.writeFloat(x); b.add(4).writeFloat(y); return b; }

  var FC = {}, TC = {};
  function fieldOf(name) { if (!FC[name]) FC[name] = il.class_get_field_from_name(Player, Memory.allocUtf8String(name)); return FC[name]; }
  function typeOf(f) { var k = f.toString(); if (!TC[k]) TC[k] = cs(il.type_get_name(il.field_get_type(f))); return TC[k]; }
  function getF(obj, name) {
    var f = fieldOf(name); if (f.isNull()) return undefined;
    il.field_get_value(obj, f, buf);
    switch (typeOf(f)) {
      case "System.Int32": return buf.readS32();
      case "System.Single": return Math.round(buf.readFloat() * 10000) / 10000;
      case "System.Boolean": return buf.readU8() !== 0;
      case "System.Byte": return buf.readU8();
      case "System.SByte": return buf.readS8();
      case "System.Int16": return buf.readS16();
      case "System.String": return jstr(buf.readPointer());
      default: return undefined;
    }
  }
  function setF(obj, name, value) {
    var f = fieldOf(name);
    if (f.isNull()) { console.log("  [!] 无此字段：" + name); return false; }
    var tn = typeOf(f), b = Memory.alloc(8);
    if (tn === "System.Single") b.writeFloat(value);
    else if (tn === "System.Boolean") b.writeU8(value ? 1 : 0);
    else if (tn === "System.Byte") b.writeU8(value & 0xff);
    else if (tn === "System.SByte") b.writeS8(value);
    else if (tn === "System.Int16") b.writeS16(value);
    else if (tn === "System.Int32") b.writeS32(value | 0);
    else { console.log("  [!] 不支持的类型 " + name + " : " + tn); return false; }
    il.field_set_value(obj, f, b);
    return true;
  }

  // ══════════════════════════════════════════════════ 玩家注册表
  var fPlayerArr = il.class_get_field_from_name(Main, Memory.allocUtf8String("player"));
  if (fPlayerArr.isNull()) { console.log("[!] 找不到 Main.player"); return; }
  il.field_static_get_value(fPlayerArr, buf);
  var pArr = buf.readPointer();
  if (pArr.isNull()) { console.log("[!] Main.player 为空"); return; }
  var arrLen = pArr.add(0x18).readS32();
  function slotPtr(i) { return pArr.add(0x20 + i * Process.pointerSize).readPointer(); }

  // 本地玩家：优先属性 get_LocalPlayer（单机/联机都准），退回 get_myPlayer，再退回扫描
  var localPtr = null;
  try { var lp = callStatic(Main, "get_LocalPlayer", 0, null); if (lp && !lp.isNull()) localPtr = lp; } catch (e) {}
  if (!localPtr) {
    try {
      var r = callStatic(Main, "get_myPlayer", 0, null);
      if (r && !r.isNull()) { var idx = r.readS32(); if (idx >= 0 && idx < arrLen) { var q = slotPtr(idx); if (!q.isNull()) localPtr = q; } }
    } catch (e) {}
  }
  if (!localPtr) {
    for (var s = 0; s < arrLen; s++) {
      var p = slotPtr(s); if (p.isNull()) continue;
      if (getF(p, "active")) { localPtr = p; break; }
    }
  }

  var all = [];
  for (var i2 = 0; i2 < arrLen; i2++) {
    var pp = slotPtr(i2); if (pp.isNull()) continue;
    var nm = getF(pp, "name") || "";
    var act = !!getF(pp, "active");
    if (!act && !nm) continue;
    all.push({
      slot: i2, ptr: pp, name: nm, active: act,
      whoAmI: getF(pp, "whoAmI"), life: getF(pp, "statLife"),
      lifeMax: getF(pp, "statLifeMax2"), mana: getF(pp, "statMana"),
      defense: getF(pp, "statDefense"), diff: getF(pp, "difficulty"),
      isLocal: localPtr ? pp.equals(localPtr) : false
    });
  }

  if (CONFIG.scan) {
    console.log("=== 角色扫描（player 数组长度 " + arrLen + "，检出 " + all.length + " 个）===");
    if (!all.length) {
      console.log("  （没有角色数据：可能还在主菜单。先进入一个世界的角色再运行）");
    }
    for (var k = 0; k < all.length; k++) {
      var e = all[k];
      console.log("  " + (e.isLocal ? "★" : " ") + " 槽位#" + e.slot + " whoAmI=" + e.whoAmI +
        " 名字=" + (e.name || "(空)") + " 生命=" + e.life + "/" + e.lifeMax +
        " 魔力=" + e.mana + " 防御=" + e.defense + " 难度=" + e.diff + " 活跃=" + (e.active ? "是" : "否") +
        (e.isLocal ? "  ← 本地玩家" : ""));
    }
  }

  // ══════════════════════════════════════════════════ 目标解析
  function resolveTargets(sel) {
    sel = String(sel || "local").trim();
    if (sel === "local") {
      for (var i = 0; i < all.length; i++) if (all[i].isLocal) return [all[i]];
      for (var j = 0; j < all.length; j++) if (all[j].active) return [all[j]];
      return [];
    }
    if (sel === "all" || sel === "active") return all.filter(function (e) { return e.active; });
    if (sel.indexOf("name:") === 0) {
      var want = sel.substring(5).trim();
      var exact = all.filter(function (e) { return e.name === want; });
      if (exact.length) return exact;
      return all.filter(function (e) { return e.name.indexOf(want) >= 0; });
    }
    if (sel.indexOf("slot:") === 0) {
      var idx = parseInt(sel.substring(5), 10);
      return all.filter(function (e) { return e.slot === idx; });
    }
    console.log("[!] 认不出的 target：" + sel + "（可用 local / all / name:角色名 / slot:0）");
    return [];
  }
  var targets = resolveTargets(CONFIG.target);
  console.log("[*] 目标选择 " + JSON.stringify(CONFIG.target) + " → 命中 " + targets.length + " 个角色" +
    (targets.length ? "：" + targets.map(function (t) { return "#" + t.slot + " " + t.name; }).join(", ") : ""));
  if (!targets.length) { console.log("[!] 没有命中角色，结束（不做任何修改）"); return; }

  // ══════════════════════════════════════════════════ 配置模板（HTTP 拉取）
  function httpGet(url) {
    try {
      var mm = /^http:\/\/([^:\/]+):(\d+)(\/.*)$/.exec(url);
      if (!mm) return null;
      var host = mm[1], port = parseInt(mm[2], 10), path = mm[3];
      var libc = Process.getModuleByName("libc.so");
      function ce(n) { var p = null; try { p = libc.findExportByName(n); } catch (e) {} if (!p) { try { p = libc.getExportByName(n); } catch (e) {} } return p; }
      var socket = new NativeFunction(ce("socket"), "int", ["int", "int", "int"]);
      var connect = new NativeFunction(ce("connect"), "int", ["int", "pointer", "int"]);
      var send = new NativeFunction(ce("send"), "long", ["int", "pointer", "ulong", "int"]);
      var recv = new NativeFunction(ce("recv"), "long", ["int", "pointer", "ulong", "int"]);
      var close = new NativeFunction(ce("close"), "int", ["int"]);
      var fd = socket(2, 1, 0); if (fd < 0) return null;
      var pa = Memory.alloc(16);
      pa.writeU16(2); pa.add(2).writeU16(((port & 0xff) << 8) | (port >> 8));
      pa.add(4).writeU32(0x0100007f);
      if (connect(fd, pa, 16) !== 0) { close(fd); return null; }
      var req = "GET " + path + " HTTP/1.0\r\nHost: " + host + "\r\nConnection: close\r\n\r\n";
      send(fd, Memory.allocUtf8String(req), req.length, 0);
      var cap = 1024 * 1024, b = Memory.alloc(cap), total = 0, n;
      while ((n = recv(fd, b.add(total), 65536, 0)) > 0) { total += n; if (total >= cap) break; }
      close(fd); b.add(total).writeU8(0);
      var text = b.readUtf8String(total);
      var sep = text.indexOf("\r\n\r\n");
      return sep >= 0 ? text.substring(sep + 4) : null;
    } catch (e) { return null; }
  }

  var persistent = {}, continuous = {}, actions = CONFIG.actions || {};
  if (CONFIG.profile) {
    var body = httpGet(CONFIG.profilesUrl);
    if (!body) {
      console.log("[!] 取不到配置模板 " + CONFIG.profilesUrl + "（HTTP 服务没起？）—— 只用内联配置继续");
    } else {
      var cfg = null;
      try { cfg = JSON.parse(body); } catch (e) { console.log("[!] profiles.json 解析失败：" + e); }
      if (cfg && cfg.profiles && cfg.profiles[CONFIG.profile]) {
        var prof = cfg.profiles[CONFIG.profile];
        var k;
        for (k in (prof.persistent || {})) persistent[k] = prof.persistent[k];
        for (k in (prof.continuous || {})) continuous[k] = prof.continuous[k];
        var merged = {};
        for (k in actions) merged[k] = actions[k];
        for (k in (prof.actions || {})) merged[k] = prof.actions[k];
        actions = merged;
        console.log("[*] 已加载配置模板「" + CONFIG.profile + "」：持久 " + Object.keys(persistent).length +
          " 项 / 持续 " + Object.keys(continuous).length + " 项");
      } else if (cfg) {
        console.log("[!] profiles.json 里没有名为「" + CONFIG.profile + "」的模板；可用：" +
          Object.keys(cfg.profiles || {}).join(", "));
      }
    }
  }
  // 内联配置覆盖（优先级更高）
  var kk;
  for (kk in CONFIG.persistent) persistent[kk] = CONFIG.persistent[kk];
  for (kk in CONFIG.continuous) continuous[kk] = CONFIG.continuous[kk];

  // ══════════════════════════════════════════════════ 执行
  function applyPersistent(t) {
    var n = 0;
    for (var k in persistent) if (setF(t.ptr, k, persistent[k])) { n++; console.log("    [持久] " + k + " = " + persistent[k]); }
    return n;
  }
  var hookCount = 0;
  function installContinuous() {
    var keys = Object.keys(continuous);
    if (!keys.length) return null;
    var mi = il.class_get_method_from_name(Player, Memory.allocUtf8String("ResetEffects"), 0);
    if (mi.isNull()) { console.log("[!] 找不到 ResetEffects"); return null; }
    var mine = {};
    for (var i = 0; i < targets.length; i++) mine[targets[i].ptr.toString()] = true;
    console.log("[*] Hook Player.ResetEffects @ " + mi.readPointer() + "，对 " + targets.length +
      " 个角色持续压住 " + keys.length + " 个字段：" + keys.join(", "));
    return Interceptor.attach(mi.readPointer(), {
      onEnter: function (a) { this.p = a[0]; this.mine = !!mine[a[0].toString()]; },
      onLeave: function () {
        if (!this.mine) return;
        hookCount++;
        for (var i = 0; i < keys.length; i++) setF(this.p, keys[i], continuous[keys[i]]);
      }
    });
  }
  function buffArrayOf(t) { il.field_get_value(t.ptr, fieldOf("buffType"), buf); return buf.readPointer(); }
  function doActions(t, isFirst) {
    if (actions.heal) {
      if (actions.heal < 0) { var mx = getF(t.ptr, "statLifeMax2") || 0; callOn(t.ptr, "Heal", 1, [intArg(mx)]); console.log("    [动作] 回满生命 +" + mx); }
      else { callOn(t.ptr, "Heal", 1, [intArg(actions.heal)]); console.log("    [动作] 治疗 " + actions.heal); }
    }
    if (actions.buffs && actions.buffs.length) {
      for (var i = 0; i < actions.buffs.length; i++) {
        var b = actions.buffs[i];
        callOn(t.ptr, "AddBuff", 3, [intArg(b.type), intArg(b.time || 36000), boolArg(!!b.quiet)]);
        console.log("    [动作] 加增益 " + b.type + " (" + (b.time || 36000) + " 帧)");
      }
    }
    if (actions.clearDebuffs) {
      var arr = buffArrayOf(t);
      if (!arr.isNull()) {
        var len = arr.add(0x18).readS32(), del = 0;
        for (var k = 0; k < len; k++) {
          var id = arr.add(0x20 + k * 4).readS32();
          if (id > 0 && DEBUFF_IDS.indexOf(id) >= 0) { callOn(t.ptr, "DelBuff", 1, [intArg(k)]); del++; }
        }
        console.log("    [动作] 清除减益 " + del + " 个");
      }
    }
    if (actions.clearAllBuffs) {
      var a2 = buffArrayOf(t);
      if (!a2.isNull()) {
        var l2 = a2.add(0x18).readS32(), d2 = 0;
        for (var k2 = 0; k2 < l2; k2++) if (a2.add(0x20 + k2 * 4).readS32() > 0) { callOn(t.ptr, "DelBuff", 1, [intArg(k2)]); d2++; }
        console.log("    [动作] 清除全部增益 " + d2 + " 个");
      }
    }
    if (isFirst && actions.teleport) {
      callOn(t.ptr, "Teleport", 3, [vec2Arg(actions.teleport.x, actions.teleport.y), intArg(1), intArg(0)]);
      console.log("    [动作] 传送到 (" + actions.teleport.x + ", " + actions.teleport.y + ")");
    }
    if (actions.spawn && actions.spawn.length) {
      il.field_get_value(t.ptr, fieldOf("position"), buf);
      var cx = buf.readFloat(), cy = buf.add(4).readFloat();
      for (var s2 = 0; s2 < actions.spawn.length; s2++) {
        var it = actions.spawn[s2];
        var mi2 = il.class_get_method_from_name(ItemC, Memory.allocUtf8String("NewItem"), 9);
        if (!mi2.isNull()) {
          var av = Memory.alloc(Process.pointerSize * 9);
          var vals = [cx, cy, 0, 0, it.type, it.stack || 1, 0, it.prefix || 0, 0];
          for (var q = 0; q < 9; q++) { var tmp = Memory.alloc(4); tmp.writeS32(vals[q] | 0); av.add(q * Process.pointerSize).writePointer(tmp); }
          exc.writePointer(ptr(0));
          il.runtime_invoke(mi2, NULL, av, exc);
        }
        console.log("    [动作] 掉落物品 " + it.type + " x" + (it.stack || 1));
      }
    }
    if (actions.toInventory && actions.toInventory.length) {
      il.field_get_value(t.ptr, fieldOf("inventory"), buf);
      var inv = buf.readPointer();
      var sd = il.class_get_method_from_name(ItemC, Memory.allocUtf8String("SetDefaults"), 1);
      var fStack = il.class_get_field_from_name(ItemC, Memory.allocUtf8String("stack"));
      var sb = Memory.alloc(8);
      for (var s3 = 0; s3 < actions.toInventory.length; s3++) {
        var e = actions.toInventory[s3];
        var si = inv.add(0x20 + e.slot * Process.pointerSize).readPointer();
        if (si.isNull()) { console.log("    [!] 背包槽 " + e.slot + " 无 Item 实例，跳过"); continue; }
        exc.writePointer(ptr(0));
        var av2 = Memory.alloc(Process.pointerSize); av2.writePointer(intArg(e.type));
        il.runtime_invoke(sd, si, av2, exc);
        sb.writeS32(e.stack || 1); il.field_set_value(si, fStack, sb);
        console.log("    [动作] 背包槽 " + e.slot + " ← " + e.type + " x" + (e.stack || 1));
      }
    }
  }

  console.log("=== 对每个目标执行 ===");
  for (var ti = 0; ti < targets.length; ti++) {
    var t = targets[ti];
    console.log("  → 槽位#" + t.slot + " " + t.name + (t.isLocal ? "（本地玩家）" : ""));
    if (!CONFIG.enabled) continue;
    applyPersistent(t);
    doActions(t, ti === 0);
  }
  if (CONFIG.enabled) installContinuous();

  // 回读校验
  console.log("=== 执行后回读 ===");
  for (var vi = 0; vi < targets.length; vi++) {
    var v = targets[vi];
    console.log("  #" + v.slot + " " + v.name +
      " 生命=" + getF(v.ptr, "statLife") + "/" + getF(v.ptr, "statLifeMax2") +
      " 魔力=" + getF(v.ptr, "statMana") + "/" + getF(v.ptr, "statManaMax2") +
      " 防御=" + getF(v.ptr, "statDefense") +
      " 难度=" + getF(v.ptr, "difficulty") +
      " 移速=" + getF(v.ptr, "moveSpeed") + " 幸运=" + getF(v.ptr, "luck"));
  }
  if (!CONFIG.enabled) {
    console.log("[*] enabled=false —— 只读模式，未做任何修改。");
    console.log("    要修改：把 CONFIG.enabled 改成 true，并设置 target（local/all/name:xx/slot:n）与 profile 或内联配置。");
  } else {
    console.log("[*] 完成。持续类字段靠 Hook 维持（命中 " + hookCount + " 次），保持脚本加载即可；unload 后失效。");
  }

  // 同会话内可手动调用
  globalThis.DSH = {
    players: function () { return all.map(function (e) { return { slot: e.slot, name: e.name, isLocal: e.isLocal, active: e.active }; }); },
    targets: targets,
    get: function (n, i) { return getF((targets[i || 0] || {}).ptr, n); },
    set: function (n, v, i) { return setF((targets[i || 0] || {}).ptr, n, v); },
    call: callOn, Player: Player, Main: Main, Item: ItemC, il2cpp: il,
    hookCount: function () { return hookCount; },
    reload: function (profile) { CONFIG.profile = profile; }
  };
  console.log("[*] globalThis.DSH 可用：DSH.players() / DSH.set('statLife',500) / DSH.hookCount()");
})();
