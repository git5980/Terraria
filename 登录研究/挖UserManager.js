/* 一次性挖出 Android_UserManager 的字段+方法（含字段类型/偏移、方法地址/参数个数），写文件 */
(function () {
  var F = null;
  function initFile() {
    try {
      var ctx = Java.use('android.app.ActivityThread').currentApplication();
      var d = ctx.getExternalFilesDir(null);
      F = Java.use('java.io.FileOutputStream').$new(Java.use('java.io.File').$new(d, 'dsha_um2.log'), true);
      return String(d);
    } catch (e) { return 'err ' + e; }
  }
  function line(m) {
    try { if (F) { F.write(Java.use('java.lang.String').$new(m + '\n').getBytes('UTF-8')); F.flush(); } } catch (e) {}
  }
  var dir = initFile(), mod = Process.findModuleByName('libil2cpp.so');
  line('==== 挖 UserManager ' + new Date().toISOString() + ' ====');
  if (!mod) { line('no il2cpp'); JSON.stringify({dir:dir}); } else {
    var g = function (n, r, a) { var p = mod.findExportByName(n); return p ? new NativeFunction(p, r, a) : null; };
    var domain_get = g('il2cpp_domain_get', 'pointer', []);
    var get_asms = g('il2cpp_domain_get_assemblies', 'pointer', ['pointer','pointer']);
    var asm_img = g('il2cpp_assembly_get_image', 'pointer', ['pointer']);
    var img_name = g('il2cpp_image_get_name', 'pointer', ['pointer']);
    var icc = g('il2cpp_image_get_class_count', 'ulong', ['pointer']);
    var img_class = g('il2cpp_image_get_class', 'pointer', ['pointer','ulong']);
    var cls_name = g('il2cpp_class_get_name', 'pointer', ['pointer']);
    var cls_ns = g('il2cpp_class_get_namespace', 'pointer', ['pointer']);
    var cls_methods = g('il2cpp_class_get_methods', 'pointer', ['pointer','pointer']);
    var m_name = g('il2cpp_method_get_name', 'pointer', ['pointer']);
    var m_ptr = g('il2cpp_method_get_pointer', 'pointer', ['pointer']);
    var cls_fields = g('il2cpp_class_get_fields', 'pointer', ['pointer','pointer']);
    var f_name = g('il2cpp_field_get_name', 'pointer', ['pointer']);
    var f_offset = g('il2cpp_field_get_offset', 'uint', ['pointer']);
    var f_type = g('il2cpp_field_get_type', 'pointer', ['pointer']);
    var t_name = g('il2cpp_type_get_name', 'pointer', ['pointer']);
    var f_static = g('il2cpp_field_get_flags', 'uint', ['pointer']);
    var dom = domain_get(), sz = Memory.alloc(8), asms = get_asms(dom, sz), n = sz.readU64().toNumber();
    var want = { 'Android_UserManager':1, 'User':1, 'LoginState':1, 'UserState':1 };
    for (var i = 0; i < n; i++) {
      var img = asm_img(asms.add(i * Process.pointerSize).readPointer());
      if (img_name(img).readUtf8String() !== 'Assembly-CSharp.dll') continue;
      var cc = icc(img);
      for (var c = 0; c < cc; c++) {
        var k = img_class(img, c); if (k.isNull()) continue;
        var cn = cls_name(k).readUtf8String(), ns = cls_ns(k).readUtf8String();
        if (!want[cn]) continue;
        line('===== ' + (ns ? ns+'.' : '') + cn + ' =====');
        // 字段
        var fi = Memory.alloc(8); fi.writePointer(ptr(0)); var ff, fg = 0;
        while (fg++ < 300) {
          ff = cls_fields(k, fi); if (ff.isNull()) break;
          var fnm = f_name(ff).readUtf8String();
          var ofs = 0, tn = '?', fl = 0;
          try { ofs = f_offset(ff); } catch (e) {}
          try { tn = t_name(f_type(ff)).readUtf8String(); } catch (e) {}
          try { fl = f_static(ff); } catch (e) {}
          line('  [字段] ' + fnm + ' : ' + tn + '  offset=' + ofs + ' flags=0x' + fl.toString(16));
        }
        // 方法
        var mi = Memory.alloc(8); mi.writePointer(ptr(0)); var mm, mg = 0;
        while (mg++ < 500) {
          mm = cls_methods(k, mi); if (mm.isNull()) break;
          var mn = m_name(mm).readUtf8String();
          var fp = null; try { fp = m_ptr(mm); } catch (e) {}
          line('  [方法] ' + mn + '  ptr=' + fp);
        }
      }
      break;
    }
    line('==== 结束 ====');
  }
  JSON.stringify({ ok: true, dir: dir });
})();
