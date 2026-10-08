/*
 * ============================================================================
 *  泰拉瑞亚（国服 com.xd.terraria）事件控制脚本
 * ============================================================================
 *  默认只读：CONFIG.enabled=false 时只扫描当前所有事件状态，不做任何修改。
 *
 *  用法：
 *    CONFIG.action = "血月-开"        ← 触发/停止某个事件（模板来自 events.json）
 *    CONFIG.enabled = true            ← 必须同时打开开关才会真的执行
 *    也可以不用模板，直接写：
 *      CONFIG.set  = { "Main.bloodMoon": true }
 *      CONFIG.call = [ { target:"Main", method:"StartInvasion", args:[1] } ]
 *
 *  模板文件：http://127.0.0.1:8791/events.json（容器 HTTP 服务，和 profiles.json 同一通道）
 *
 *  ⚠️ 触发类操作会真实改变世界：入侵/血月/日食会刷怪，建议先备份存档。
 * ============================================================================
 */
var CONFIG = {
  enabled: false,                                   // ← 总开关
  scan: true,                                       // 扫描并打印事件状态
  action: "",                                       // events.json 里的模板名
  eventsUrl: "http://127.0.0.1:8791/events.json",
  set: {},                                          // 直接写静态字段
  call: []                                          // 直接调方法
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
    class_get_fields: F("il2cpp_class_get_fields", "pointer", ["pointer", "pointer"]),
    class_get_field_from_name: F("il2cpp_class_get_field_from_name", "pointer", ["pointer", "pointer"]),
    class_get_method_from_name: F("il2cpp_class_get_method_from_name", "pointer", ["pointer", "pointer", "int"]),
    field_get_name: F("il2cpp_field_get_name", "pointer", ["pointer"]),
    field_get_type: F("il2cpp_field_get_type", "pointer", ["pointer"]),
    field_get_flags: F("il2cpp_field_get_flags", "uint32", ["pointer"]),
    type_get_name: F("il2cpp_type_get_name", "pointer", ["pointer"]),
    field_static_get_value: F("il2cpp_field_static_get_value", "void", ["pointer", "pointer"]),
    field_static_set_value: F("il2cpp_field_static_set_value", "void", ["pointer", "pointer"]),
    runtime_invoke: F("il2cpp_runtime_invoke", "pointer", ["pointer", "pointer", "pointer", "pointer"]),
    method_get_param_count: F("il2cpp_method_get_param_count", "uint32", ["pointer"]),
    string_chars: F("il2cpp_string_chars", "pointer", ["pointer"]),
    thread_attach: F("il2cpp_thread_attach", "pointer", ["pointer"])
  };
  function cs(p) { try { return (!p || p.isNull()) ? null : p.readUtf8String(); } catch (e) { return null; } }
  var dom = il.domain_get(); il.thread_attach(dom);
  var szP = Memory.alloc(8), asms = il.domain_get_assemblies(dom, szP);
  var nAsm = szP.readU64().toNumber(), ACS = null;
  for (var i = 0; i < nAsm; i++) {
    var img = il.assembly_get_image(asms.add(i * Process.pointerSize).readPointer());
    if (String(cs(il.image_get_name(img))) === "Assembly-CSharp.dll") ACS = img;
  }
  if (!ACS) { console.log("[!] 找不到 Assembly-CSharp.dll"); return; }
  function cls(ns, nm) { return il.class_from_name(ACS, Memory.allocUtf8String(ns), Memory.allocUtf8String(nm)); }

  // 简名 → 类（脚本里/模板里都用简名）
  var ALIAS = {
    "Main": ["Terraria", "Main"],
    "WorldGen": ["Terraria", "WorldGen"],
    "NPC": ["Terraria", "NPC"],
    "Player": ["Terraria", "Player"],
    "Sandstorm": ["Terraria.GameContent.Events", "Sandstorm"],
    "BirthdayParty": ["Terraria.GameContent.Events", "BirthdayParty"],
    "LanternNight": ["Terraria.GameContent.Events", "LanternNight"],
    "DD2Event": ["Terraria.GameContent.Events", "DD2Event"],
    "CreditsRollEvent": ["Terraria.GameContent.Events", "CreditsRollEvent"],
    "CultistRitual": ["Terraria.GameContent.Events", "CultistRitual"],
    "MysticLogFairiesEvent": ["Terraria.GameContent.Events", "MysticLogFairiesEvent"],
    "MoonlordDeathDrama": ["Terraria.GameContent.Events", "MoonlordDeathDrama"],
    "InvasionID": ["Terraria.ID", "InvasionID"]
  };
  var CC = {};
  function resolveClass(short) {
    if (CC[short]) return CC[short];
    var pair = ALIAS[short];
    var k = pair ? cls(pair[0], pair[1]) : cls("Terraria", short);
    CC[short] = k;
    return k;
  }
  var buf = Memory.alloc(16);
  function typeName(f) { return cs(il.type_get_name(il.field_get_type(f))); }
  function readVal(f, tn) {
    il.field_static_get_value(f, buf);
    if (tn === "System.Boolean") return buf.readU8() !== 0;
    if (tn === "System.Int32") return buf.readS32();
    if (tn === "System.Int16") return buf.readS16();
    if (tn === "System.Byte") return buf.readU8();
    if (tn === "System.Single") return Math.round(buf.readFloat() * 10000) / 10000;
    if (tn === "System.Double") return Math.round(buf.readDouble() * 100) / 100;
    if (tn === "System.String") return jstr(buf.readPointer());
    return "<" + tn + ">";
  }
  function jstr(p) { if (!p || p.isNull()) return ""; try { var l = p.add(0x10).readS32(); return l <= 0 ? "" : il.string_chars(p).readUtf16String(l); } catch (e) { return ""; } }

  // 扫描表：简名 → 关心的字段（留空 = 打印该类全部静态原始字段）
  var SCAN = {
    "Main": ["bloodMoon", "eclipse", "pumpkinMoon", "snowMoon", "invasionType", "invasionSize", "invasionX",
      "invasionDelay", "invasionWarn", "raining", "rainTime", "maxRaining", "slimeRain", "slimeRainTime",
      "slimeRainKillCount", "slimeWarningTime", "dayTime", "time", "moonPhase", "hardMode", "halloween", "xMas",
      "forceHalloweenForToday", "forceXMasForToday", "forceHalloweenForever", "forceXMasForever",
      "windSpeedCurrent", "thunderDelay", "checkForSpawns", "numStars"],
    "Sandstorm": ["Happening", "TimeLeft", "Severity", "IntendedSeverity"],
    "DD2Event": ["Ongoing", "OngoingDifficulty", "DownedInvasionT1", "DownedInvasionT2", "DownedInvasionT3",
      "WonThisRun", "LostThisRun", "_timeLeftUntilSpawningBegins", "INVASION_ID"],
    "BirthdayParty": ["ManualParty", "GenuineParty", "PartyDaysOnCooldown", "_wasCelebrating"],
    "LanternNight": ["ManualLanterns", "GenuineLanterns", "NextNightIsLanternNight", "LanternNightsOnCooldown", "_wasLanternNight"],
    "CreditsRollEvent": ["_creditsRollRemainingTime", "MAX_TIME_FOR_CREDITS_ROLL_IN_FRAMES"],
    "CultistRitual": ["delay", "recheck", "delayStart", "respawnDelay", "timePerCultist", "recheckStart"]
  };
  function scanEvents() {
    console.log("=== 事件状态扫描 ===");
    for (var short in SCAN) {
      var k = resolveClass(short);
      if (k.isNull()) { console.log("  [" + short + "] 类不存在"); continue; }
      var parts = [];
      for (var i = 0; i < SCAN[short].length; i++) {
        var fn = SCAN[short][i];
        var f = il.class_get_field_from_name(k, Memory.allocUtf8String(fn));
        if (f.isNull()) { parts.push(fn + "=<无>"); continue; }
        parts.push(fn + "=" + readVal(f, typeName(f)));
      }
      console.log("  [" + short + "] " + parts.join("  "));
    }
    // 入侵类型对照（常量）
    var iid = resolveClass("InvasionID");
    if (!iid.isNull()) {
      var it = Memory.alloc(8), f2, acc = [];
      while (!(f2 = il.class_get_fields(iid, it)).isNull()) {
        var nm = cs(il.field_get_name(f2));
        if (!nm || nm.indexOf("Cached") === 0) continue;
        acc.push(nm + "=" + readVal(f2, typeName(f2)));
      }
      console.log("  [InvasionID] " + acc.join("  "));
    }
  }

  // ══════════════════════════════════════ HTTP 拉模板
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
      pa.writeU16(2); pa.add(2).writeU16(((port & 0xff) << 8) | (port >> 8)); pa.add(4).writeU32(0x0100007f);
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

  // ══════════════════════════════════════ 执行器
  function writeField(path, value) {
    var i = path.lastIndexOf(".");
    var short = path.substring(0, i), fn = path.substring(i + 1);
    var k = resolveClass(short);
    if (k.isNull()) { console.log("    [!] 类不存在：" + short); return false; }
    var f = il.class_get_field_from_name(k, Memory.allocUtf8String(fn));
    if (f.isNull()) { console.log("    [!] 字段不存在：" + path); return false; }
    var tn = typeName(f), b = Memory.alloc(8);
    if (tn === "System.Boolean") b.writeU8(value ? 1 : 0);
    else if (tn === "System.Int32") b.writeS32(value | 0);
    else if (tn === "System.Int16") b.writeS16(value | 0);
    else if (tn === "System.Byte") b.writeU8(value & 0xff);
    else if (tn === "System.Single") b.writeFloat(value);
    else if (tn === "System.Double") b.writeDouble(value);
    else { console.log("    [!] 不支持的类型 " + path + " : " + tn); return false; }
    var old = readVal(f, tn);
    il.field_static_set_value(f, b);
    console.log("    [写] " + path + " : " + old + " → " + readVal(f, tn));
    return true;
  }
  function callMethod(target, method, args) {
    var obj = null, short = target;
    if (target.indexOf(".") > 0) {           // 形如 WorldGen.mysticLogsEvent → 取静态字段里的实例
      var dot = target.indexOf(".");
      var ck = resolveClass(target.substring(0, dot)), fld = target.substring(dot + 1);
      if (ck.isNull()) { console.log("    [!] 类不存在：" + target); return false; }
      var ff = il.class_get_field_from_name(ck, Memory.allocUtf8String(fld));
      if (ff.isNull()) { console.log("    [!] 实例字段不存在：" + target); return false; }
      il.field_static_get_value(ff, buf);
      obj = buf.readPointer();
      if (obj.isNull()) { console.log("    [!] 实例为空：" + target); return false; }
      var ftn = typeName(ff);                       // 用字段声明类型定位实例所属类
      var d2 = ftn.lastIndexOf(".");
      var instCls = cls(ftn.substring(0, d2), ftn.substring(d2 + 1));
      if (instCls.isNull()) { console.log("    [!] 实例类型解析失败：" + ftn); return false; }
      var mi0 = il.class_get_method_from_name(instCls, Memory.allocUtf8String(method), args.length);
      if (mi0.isNull()) { console.log("    [!] 方法不存在：" + method + "/" + args.length + " 参"); return false; }
      return invokeWith(mi0, obj, args, target + "." + method);
    }
    var k = resolveClass(short);
    if (k.isNull()) { console.log("    [!] 类不存在：" + short); return false; }
    var mi = il.class_get_method_from_name(k, Memory.allocUtf8String(method), args.length);
    if (mi.isNull()) { console.log("    [!] 方法不存在：" + method + "/" + args.length + " 参"); return false; }
    return invokeWith(mi, NULL, args, short + "." + method);
  }
  function invokeWith(mi, obj, args, label) {
    var argv = null;
    if (args && args.length) {
      argv = Memory.alloc(Process.pointerSize * args.length);
      for (var i = 0; i < args.length; i++) {
        var v = args[i], cell;
        if (v === "null" || v === null) { cell = Memory.alloc(8); cell.writeU64(0); }        // Nullable<T> 空 / 引用空
        else if (typeof v === "boolean") { cell = Memory.alloc(8); cell.writeU8(v ? 1 : 0); }
        else if (typeof v === "number" && Math.floor(v) === v) { cell = Memory.alloc(8); cell.writeS32(v); }
        else { cell = Memory.alloc(8); cell.writeFloat(v); }
        argv.add(i * Process.pointerSize).writePointer(cell);
      }
    }
    var exc = Memory.alloc(Process.pointerSize); exc.writePointer(ptr(0));
    il.runtime_invoke(mi, obj, argv, exc);
    var bad = !exc.readPointer().isNull();
    console.log("    [调用] " + label + "(" + JSON.stringify(args || []) + ")" + (bad ? "  ⚠ 抛了托管异常（效果通常已生效，游戏自身逻辑可能在非托管线程里失败）" : "  ✓"));
    return true;
  }

  // ══════════════════════════════════════ 主流程
  if (CONFIG.scan) scanEvents();

  var sets = {}, calls = [];
  if (CONFIG.action) {
    var body = httpGet(CONFIG.eventsUrl);
    if (!body) console.log("[!] 取不到事件模板 " + CONFIG.eventsUrl + "（容器 HTTP 服务没起？）");
    else {
      var cfg = null;
      try { cfg = JSON.parse(body); } catch (e) { console.log("[!] events.json 解析失败：" + e); }
      var tpl = cfg && cfg.模板 ? cfg.模板[CONFIG.action] : null;
      if (!tpl) console.log("[!] 模板里没有「" + CONFIG.action + "」；可用：" + (cfg && cfg.模板 ? Object.keys(cfg.模板).join("、") : ""));
      else {
        for (var s in (tpl.set || {})) sets[s] = tpl.set[s];
        if (tpl.call) calls = calls.concat(tpl.call);
        console.log("[*] 已加载模板「" + CONFIG.action + "」");
      }
    }
  }
  for (var s2 in CONFIG.set) sets[s2] = CONFIG.set[s2];
  calls = calls.concat(CONFIG.call || []);

  console.log("=== 待执行：" + Object.keys(sets).length + " 个字段 / " + calls.length + " 个方法调用 ===");
  if (!CONFIG.enabled) {
    console.log("[*] enabled=false —— 只读模式，未做任何修改。");
    console.log("    要触发：设置 CONFIG.action=\"血月-开\" 之类，并把 CONFIG.enabled 改成 true。");
  } else {
    for (var p in sets) writeField(p, sets[p]);
    for (var c = 0; c < calls.length; c++) callMethod(calls[c].target, calls[c].method, calls[c].args || []);
    console.log("=== 执行后事件状态 ===");
    scanEvents();
  }

  globalThis.EVT = {
    scan: scanEvents,
    set: writeField,
    call: callMethod,
    templates: function () { var b = httpGet(CONFIG.eventsUrl); try { return Object.keys(JSON.parse(b).模板); } catch (e) { return []; } }
  };
  console.log("[*] globalThis.EVT 可用：EVT.scan() / EVT.set('Main.bloodMoon', true) / EVT.call('Main','StartInvasion',[1]) / EVT.templates()");
})();
