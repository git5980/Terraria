/*
 * Terraria (国服 com.xd.terraria / Unity + IL2CPP) 物品全量提取脚本
 * 运行环境：JsHook MCP 模式，注入到 com.xd.terraria 进程后执行（也可用 eval 加载本文件）
 *
 * 原理：
 *   Assembly-CSharp.dll -> Terraria.ID.ItemID   (静态 int 常量 = 英文物品标识符 -> 数字 ID)
 *                       -> Terraria.Item       (物品实例，调用 SetDefaults(id) 填充属性)
 *                       -> Terraria.Lang.GetItemNameValue(id)  (当前语言下的物品名)
 *
 * 输出：JSONL（每行一个物品对象），UTF-8，写入设备 path
 * 归档：导出后由容器搬到 泰拉瑞亚项目/物品库/data/items_full.jsonl（游戏进程写不进 DSHA 目录）
 *
 * 实测要点（国服 1.x / Android 16）：
 *   - 游戏能直接写 /sdcard/Download（推荐输出到这里，容器/设备 shell 都能读）
 *   - 游戏读不了 /sdcard/Download/DSHA（该目录 770，属主是 DSHA 应用），别把输入脚本放那儿
 *   - 本移植版 Item.maxStack 对多数物品报 9999（实际堆叠上限由游戏另外的逻辑决定）
 *   - 少数国服自研物品没有本地化文本，Lang 会直接返回 key（形如 ItemName.XDSpringRocket15）
 */
(function () {
  var CONFIG = {
    out: "/sdcard/Download/terraria_items_raw.jsonl",
    maxId: 8000,          // 上限保护，实际按 ItemID 常量与 SetDefaults 结果确定
    flushBytes: 262144,   // 近似刷新阈值（UTF-16 字符数）
    logEvery: 500
  };

  var m = Process.findModuleByName("libil2cpp.so");
  if (!m) { console.log("[!] libil2cpp.so 未加载"); return "no-il2cpp"; }
  function E(n) {
    var p = null;
    try { p = m.findExportByName(n); } catch (e) {}
    if (!p) { try { p = m.getExportByName(n); } catch (e) {} }
    return p;
  }
  function F(n, ret, args) {
    var a = E(n);
    if (!a) throw new Error("缺少导出 " + n);
    return new NativeFunction(a, ret, args);
  }

  var il = {
    domain_get: F("il2cpp_domain_get", "pointer", []),
    domain_get_assemblies: F("il2cpp_domain_get_assemblies", "pointer", ["pointer", "pointer"]),
    assembly_get_image: F("il2cpp_assembly_get_image", "pointer", ["pointer"]),
    image_get_name: F("il2cpp_image_get_name", "pointer", ["pointer"]),
    class_from_name: F("il2cpp_class_from_name", "pointer", ["pointer", "pointer", "pointer"]),
    class_get_fields: F("il2cpp_class_get_fields", "pointer", ["pointer", "pointer"]),
    class_get_method_from_name: F("il2cpp_class_get_method_from_name", "pointer", ["pointer", "pointer", "int"]),
    field_get_name: F("il2cpp_field_get_name", "pointer", ["pointer"]),
    field_get_type: F("il2cpp_field_get_type", "pointer", ["pointer"]),
    type_get_name: F("il2cpp_type_get_name", "pointer", ["pointer"]),
    field_static_get_value: F("il2cpp_field_static_get_value", "void", ["pointer", "pointer"]),
    field_get_value: F("il2cpp_field_get_value", "void", ["pointer", "pointer", "pointer"]),
    object_new: F("il2cpp_object_new", "pointer", ["pointer"]),
    runtime_invoke: F("il2cpp_runtime_invoke", "pointer", ["pointer", "pointer", "pointer", "pointer"]),
    string_chars: F("il2cpp_string_chars", "pointer", ["pointer"]),
    thread_attach: F("il2cpp_thread_attach", "pointer", ["pointer"])
  };

  var libc = Process.getModuleByName("libc.so");
  function ce(n) { var p = null; try { p = libc.findExportByName(n); } catch (e) {} if (!p) { try { p = libc.getExportByName(n); } catch (e) {} } return p; }
  var fopen = new NativeFunction(ce("fopen"), "pointer", ["pointer", "pointer"]);
  var fwrite = new NativeFunction(ce("fwrite"), "ulong", ["pointer", "ulong", "ulong", "pointer"]);
  var fclose = new NativeFunction(ce("fclose"), "int", ["pointer"]);

  function cs(p) { try { return (!p || p.isNull()) ? null : p.readUtf8String(); } catch (e) { return null; } }
  function jstr(p) {
    if (!p || p.isNull()) return "";
    try { var len = p.add(0x10).readS32(); if (len <= 0) return ""; return il.string_chars(p).readUtf16String(len); }
    catch (e) { return ""; }
  }
  function jsonEsc(s) {
    s = String(s);
    var o = "";
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i), ch = s.charAt(i);
      if (ch === '"') o += '\\"';
      else if (ch === "\\") o += "\\\\";
      else if (c < 0x20) o += "\\u" + ("000" + c.toString(16)).slice(-4);
      else o += ch;
    }
    return o;
  }
  function utf8len(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xD800 && c <= 0xDBFF) { n += 4; i++; }
      else n += 3;
    }
    return n;
  }

  // ---- 定位程序集与类 ----
  var dom = il.domain_get();
  il.thread_attach(dom);
  var szP = Memory.alloc(8);
  var asms = il.domain_get_assemblies(dom, szP);
  var nAsm = szP.readU64().toNumber(), ACS = null;
  for (var i = 0; i < nAsm; i++) {
    var img = il.assembly_get_image(asms.add(i * Process.pointerSize).readPointer());
    if (String(cs(il.image_get_name(img))) === "Assembly-CSharp.dll") ACS = img;
  }
  if (!ACS) { console.log("[!] 未找到 Assembly-CSharp.dll"); return "no-asm"; }
  function findCls(ns, name) { return il.class_from_name(ACS, Memory.allocUtf8String(ns), Memory.allocUtf8String(name)); }
  var Item = findCls("Terraria", "Item");
  var ItemID = findCls("Terraria.ID", "ItemID");
  var Lang = findCls("Terraria", "Lang");
  console.log("[*] Item=" + Item + " ItemID=" + ItemID + " Lang=" + Lang);
  if (Item.isNull() || ItemID.isNull() || Lang.isNull()) return "class-missing";

  // ---- 物品字段（只取可无损序列化的类型）----
  var KINDS = {
    "System.Int32": "i32", "System.Single": "f32", "System.Boolean": "bool",
    "System.Byte": "u8", "System.SByte": "s8", "System.Int16": "s16", "System.UInt16": "u16",
    "System.String": "str", "Microsoft.Xna.Framework.Graphics.Color": "rgba",
    "System.Nullable<System.Int32>": "nint"
  };
  var FIELDS = [], typeField = null;
  var itF = Memory.alloc(8), fInf;
  while (!(fInf = il.class_get_fields(Item, itF)).isNull()) {
    var fname = cs(il.field_get_name(fInf));
    var tname = cs(il.type_get_name(il.field_get_type(fInf)));
    var kind = KINDS[tname];
    if (!kind) continue;
    if (fname === "type") typeField = fInf;
    FIELDS.push({ n: fname, k: kind, fi: fInf });
  }
  console.log("[*] 采集字段数=" + FIELDS.length + " (Item 共 151)");

  // ---- ItemID 常量 -> 英文名 ----
  var idNames = {}, itI = Memory.alloc(8), fI, vbuf = Memory.alloc(8), maxId = 0, nConst = 0;
  while (!(fI = il.class_get_fields(ItemID, itI)).isNull()) {
    il.field_static_get_value(fI, vbuf);
    var v = vbuf.readS32();
    var nm = cs(il.field_get_name(fI));
    if (v > 0 && v < CONFIG.maxId) {
      if (!idNames[v]) idNames[v] = [];
      idNames[v].push(nm);
      if (v > maxId) maxId = v;
    }
    nConst++;
  }
  console.log("[*] ItemID 常量=" + nConst + " 有效英文名条目=" + Object.keys(idNames).length + " maxId=" + maxId);

  // ---- 输出文件 ----
  var fp = fopen(Memory.allocUtf8String(CONFIG.out), Memory.allocUtf8String("wb"));
  if (fp.isNull()) { console.log("[!] 无法写入 " + CONFIG.out); return "open-fail"; }
  var bufArr = [], bufLen = 0;
  function flush() {
    if (!bufArr.length) return;
    var s = bufArr.join("");
    bufArr = []; bufLen = 0;
    var b = Memory.allocUtf8String(s);
    fwrite(b, 1, utf8len(s), fp);
  }
  function emit(line) { bufArr.push(line); bufLen += line.length; if (bufLen >= CONFIG.flushBytes) flush(); }

  emit('{"_meta":{"game":"com.xd.terraria","runtime":"il2cpp","source":"Terraria.Item.SetDefaults + Terraria.ID.ItemID + Terraria.Lang.GetItemNameValue","fields":' + FIELDS.length + '}}\n');

  // ---- 主循环 ----
  var sd = il.class_get_method_from_name(Item, Memory.allocUtf8String("SetDefaults"), 2);
  var nameM = il.class_get_method_from_name(Lang, Memory.allocUtf8String("GetItemNameValue"), 1);
  if (sd.isNull() || nameM.isNull()) { console.log("[!] 方法查找失败 SetDefaults=" + sd + " GetItemNameValue=" + nameM); fclose(fp); return "method-missing"; }

  var args = Memory.alloc(Process.pointerSize * 2);
  var a0 = Memory.alloc(4), a1 = Memory.alloc(4), excp = Memory.alloc(Process.pointerSize);
  var nargs = Memory.alloc(Process.pointerSize), nid = Memory.alloc(4);
  var valBuf = Memory.alloc(16);
  a1.writeU8(0);

  function readField(obj, fd) {
    il.field_get_value(obj, fd.fi, valBuf);
    switch (fd.k) {
      case "i32": return valBuf.readS32();
      case "f32": return Math.round(valBuf.readFloat() * 1000) / 1000;
      case "bool": return valBuf.readU8() !== 0;
      case "u8": return valBuf.readU8();
      case "s8": return valBuf.readS8();
      case "s16": return valBuf.readS16();
      case "u16": return valBuf.readU16();
      case "rgba": return valBuf.readU32();
      case "nint": return valBuf.readU8() ? valBuf.add(4).readS32() : null;
      case "str": return jstr(valBuf.readPointer());
    }
    return null;
  }

  var ok = 0, skipped = 0, failed = 0, t0 = Date.now();
  for (var id = 1; id <= maxId; id++) {
    a0.writeS32(id);
    args.writePointer(a0);
    args.add(Process.pointerSize).writePointer(a1);
    excp.writePointer(ptr(0));
    var obj = il.object_new(Item);
    try { il.runtime_invoke(sd, obj, args, excp); } catch (e) { failed++; continue; }
    if (!excp.readPointer().isNull()) { failed++; continue; }
    var tval = (function () { il.field_get_value(obj, typeField, valBuf); return valBuf.readS32(); })();
    if (tval !== id) { skipped++; continue; }

    nid.writeS32(id);
    nargs.writePointer(nid);
    excp.writePointer(ptr(0));
    var nsObj = null;
    try { nsObj = il.runtime_invoke(nameM, NULL, nargs, excp); } catch (e) {}
    var cn = nsObj ? jstr(nsObj) : "";

    var parts = ['"id":' + id, '"en":' + JSON.stringify(idNames[id] || []), '"cn":"' + jsonEsc(cn) + '"'];
    for (var k = 0; k < FIELDS.length; k++) {
      var fd = FIELDS[k];
      var val = readField(obj, fd);
      if (val === null) parts.push('"' + fd.n + '":null');
      else if (typeof val === "string") parts.push('"' + fd.n + '":"' + jsonEsc(val) + '"');
      else parts.push('"' + fd.n + '":' + val);
    }
    emit("{" + parts.join(",") + "}\n");
    ok++;
    if (ok % CONFIG.logEvery === 0) console.log("[*] 进度 id=" + id + " ok=" + ok + " 用时 " + ((Date.now() - t0) / 1000).toFixed(1) + "s");
  }
  flush();
  fclose(fp);
  var summary = "DONE ok=" + ok + " skipped=" + skipped + " failed=" + failed + " maxId=" + maxId + " 用时 " + ((Date.now() - t0) / 1000).toFixed(1) + "s -> " + CONFIG.out;
  console.log("[*] " + summary);
  return summary;
})();
