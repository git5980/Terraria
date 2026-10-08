/* 列出 Android_UserManager / User / LoginState 的全部方法名+地址，并读关键字段 */
(function () {
  var F = null;
  function initFile() {
    try {
      var ctx = Java.use('android.app.ActivityThread').currentApplication();
      var d = ctx.getExternalFilesDir(null);
      F = Java.use('java.io.FileOutputStream').$new(Java.use('java.io.File').$new(d, 'dsha_um.log'), true);
      return String(d);
    } catch (e) { return 'err ' + e; }
  }
  function line(m) {
    try { if (F) { F.write(Java.use('java.lang.String').$new(m + '\n').getBytes('UTF-8')); F.flush(); } } catch (e) {}
    try { console.log('[UM] ' + m); } catch (e) {}
  }
  var dir = initFile(), mod = Process.findModuleByName('libil2cpp.so'), out = { dir: dir };
  if (!mod) { line('no il2cpp'); JSON.stringify(out); } else {
    var ex = function (n) { var p = mod.findExportByName(n); return p ? new NativeFunction(p, 'pointer', Array.prototype.slice.call(arguments, 1)) : null; };
    var domain_get = ex('il2cpp_domain_get');
    var get_asms = ex('il2cpp_domain_get_assemblies', 'pointer', ['pointer','pointer']);
    var asm_img = ex('il2cpp_assembly_get_image', 'pointer', ['pointer']);
    var img_name = ex('il2cpp_image_get_name', 'pointer', ['pointer']);
    var icc = ex('il2cpp_image_get_class_count', 'ulong', ['pointer']);
    var img_class = ex('il2cpp_image_get_class', 'pointer', ['pointer','ulong']);
    var cls_name = ex('il2cpp_class_get_name', 'pointer', ['pointer']);
    var cls_ns = ex('il2cpp_class_get_namespace', 'pointer', ['pointer']);
    var cls_methods = ex('il2cpp_class_get_methods', 'pointer', ['pointer','pointer']);
    var m_name = ex('il2cpp_method_get_name', 'pointer', ['pointer']);
    var m_getptr = mod.findExportByName('il2cpp_method_get_pointer');
    var m_ptr = m_getptr ? new NativeFunction(m_getptr, 'pointer', ['pointer']) : null;
    var dom = domain_get(), sz = Memory.alloc(8), asms = get_asms(dom, sz), n = sz.readU64().toNumber();
    var want = { 'Android_UserManager': 1, 'User': 1, 'LoginState': 1, 'UserState': 1, 'UserManagement': 1 };
    for (var i = 0; i < n; i++) {
      var img = asm_img(asms.add(i * Process.pointerSize).readPointer());
      if (img_name(img).readUtf8String() !== 'Assembly-CSharp.dll') continue;
      var cc = icc(img);
      for (var c = 0; c < cc; c++) {
        var k = img_class(img, c); if (k.isNull()) continue;
        var cn = cls_name(k).readUtf8String(), ns = cls_ns(k).readUtf8String();
        if (!want[cn]) continue;
        line('===== ' + (ns ? ns + '.' : '') + cn + ' =====');
        var it = Memory.alloc(8); it.writePointer(ptr(0)); var mm, g = 0;
        while (g++ < 500) {
          mm = cls_methods(k, it); if (mm.isNull()) break;
          var mn = m_name(mm).readUtf8String();
          var fp = null; try { fp = m_ptr ? m_ptr(mm) : mm.readPointer(); } catch (e) {}
          var par = 0; try { par = mm.add(Process.pointerSize * 4).readU32(); } catch (e) {}
          line('   ' + mn + '  ptr=' + fp + ' argc=' + par);
        }
      }
      break;
    }
    line('结束');
  }
  JSON.stringify(out);
})();
