/* 跟踪游戏侧登录放行点：hook Android_UserManager 的登录相关方法 + 找 XD/国服桥接类
   目的：确定「游戏等什么条件才放行」→ 之后直接在装包脚本里把它强制成已登录 */
(function () {
  var F = null;
  function initFile() {
    try {
      var ctx = Java.use('android.app.ActivityThread').currentApplication();
      var d = ctx.getExternalFilesDir(null);
      F = Java.use('java.io.FileOutputStream').$new(Java.use('java.io.File').$new(d, 'dsha_login_trace.log'), true);
      return String(d);
    } catch (e) { return 'err ' + e; }
  }
  function line(m) {
    try { if (F) { F.write(Java.use('java.lang.String').$new(m + '\n').getBytes('UTF-8')); F.flush(); } } catch (e) {}
    try { console.log('[登录跟踪] ' + m); } catch (e) {}
  }
  var dir = initFile();
  var mod = Process.findModuleByName('libil2cpp.so');
  var out = { dir: dir, found: [] };
  if (!mod) { line('no il2cpp'); JSON.stringify(out); } else {
    var domain_get = new NativeFunction(mod.findExportByName('il2cpp_domain_get'), 'pointer', []);
    var get_asms = new NativeFunction(mod.findExportByName('il2cpp_domain_get_assemblies'), 'pointer', ['pointer','pointer']);
    var asm_img = new NativeFunction(mod.findExportByName('il2cpp_assembly_get_image'), 'pointer', ['pointer']);
    var img_name = new NativeFunction(mod.findExportByName('il2cpp_image_get_name'), 'pointer', ['pointer']);
    var img_class_count = new NativeFunction(mod.findExportByName('il2cpp_image_get_class_count'), 'ulong', ['pointer']);
    var img_class = new NativeFunction(mod.findExportByName('il2cpp_image_get_class'), 'pointer', ['pointer','ulong']);
    var cls_name = new NativeFunction(mod.findExportByName('il2cpp_class_get_name'), 'pointer', ['pointer']);
    var cls_ns = new NativeFunction(mod.findExportByName('il2cpp_class_get_namespace'), 'pointer', ['pointer']);
    var cls_methods = new NativeFunction(mod.findExportByName('il2cpp_class_get_methods'), 'pointer', ['pointer','pointer']);
    var m_name = new NativeFunction(mod.findExportByName('il2cpp_method_get_name'), 'pointer', ['pointer']);
    var m_getptr = mod.findExportByName('il2cpp_method_get_pointer');
    var m_ptr = m_getptr ? new NativeFunction(m_getptr, 'pointer', ['pointer']) : null;

    var dom = domain_get(), sz = Memory.alloc(8), asms = get_asms(dom, sz), n = sz.readU64().toNumber();
    // 收集目标类的方法地址
    for (var i = 0; i < n; i++) {
      var img = asm_img(asms.add(i * Process.pointerSize).readPointer());
      if (img_name(img).readUtf8String() !== 'Assembly-CSharp.dll') continue;
      var cc = img_class_count(img);
      for (var c = 0; c < cc; c++) {
        var k = img_class(img, c);
        if (k.isNull()) continue;
        var cn = cls_name(k).readUtf8String(), ns = cls_ns(k).readUtf8String();
        var full = (ns ? ns + '.' : '') + cn;
        if (!/^(Android_UserManager|User|LoginState|UserState|PlatformUser|UserManagement|LocalUser)$/.test(cn)) continue;
        var iter = Memory.alloc(8); iter.writePointer(ptr(0));
        var mm, guard = 0;
        while (guard++ < 300) {
          mm = cls_methods(k, iter);
          if (mm.isNull()) break;
          var mn = m_name(mm).readUtf8String();
          if (!/login|auth|user|sign|Session|State/i.test(mn)) continue;
          var fp = null;
          try { fp = m_ptr ? m_ptr(mm) : mm.readPointer(); } catch (e) { fp = null; }
          if (!fp || fp.isNull()) continue;
          (function (name, addr) {
            try {
              out.found.push(name + '@' + addr);
              Interceptor.attach(addr, {
                onEnter: function (a) { line('▶ ' + name + ' 被调用'); },
                onLeave: function (r) { line('  ↳ ' + name + ' 返回 ' + r); }
              });
            } catch (e) { line('挂 ' + name + ' 失败 ' + e); }
          })(full + '::' + mn, fp);
        }
      }
      break;
    }
    line('已挂 ' + out.found.length + ' 个方法');
    line(out.found.join('\n'));
  }
  JSON.stringify(out);
})();
