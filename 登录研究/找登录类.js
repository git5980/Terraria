/* 在游戏进程里找「登录」相关的 IL2CPP 类/方法（脱机跳过登录的第一步：先知道登录由谁控制）
   做法：遍历 Assembly-CSharp 的所有类型名 + 方法名，把含 login/wx/sdk/auth/account 的挑出来写文件 */
(function () {
  var F = null;
  function initFile() {
    try {
      var ctx = Java.use('android.app.ActivityThread').currentApplication();
      F = Java.use('java.io.FileOutputStream').$new(Java.use('java.io.File').$new(ctx.getExternalFilesDir(null), 'dsha_login_classes.log'), true);
      return String(ctx.getExternalFilesDir(null));
    } catch (e) { return 'err ' + e; }
  }
  function line(m) {
    try { if (F) { F.write(Java.use('java.lang.String').$new(m + '\n').getBytes('UTF-8')); F.flush(); } } catch (e) {}
    try { console.log('[找登录] ' + m); } catch (e) {}
  }
  var dir = initFile();
  var m = Process.findModuleByName('libil2cpp.so');
  if (!m) { line('libil2cpp 未加载'); JSON.stringify({ err: 'no il2cpp' }); } else {
    var E = function (n) { var p = m.findExportByName(n); return p ? new NativeFunction(p, 'pointer', ['pointer', 'pointer']) : null; };
    var domain_get = new NativeFunction(m.findExportByName('il2cpp_domain_get'), 'pointer', []);
    var get_asms = new NativeFunction(m.findExportByName('il2cpp_domain_get_assemblies'), 'pointer', ['pointer', 'pointer']);
    var asm_img = new NativeFunction(m.findExportByName('il2cpp_assembly_get_image'), 'pointer', ['pointer']);
    var img_name = new NativeFunction(m.findExportByName('il2cpp_image_get_name'), 'pointer', ['pointer']);
    var img_class_count = new NativeFunction(m.findExportByName('il2cpp_image_get_class_count'), 'uint', ['pointer']);
    var cls_methods_ref = null;
    var img_class = new NativeFunction(m.findExportByName('il2cpp_image_get_class'), 'pointer', ['pointer', 'ulong']);
    var img_class_count2 = new NativeFunction(m.findExportByName('il2cpp_image_get_class_count'), 'ulong', ['pointer']);
    var cls_name = new NativeFunction(m.findExportByName('il2cpp_class_get_name'), 'pointer', ['pointer']);
    var cls_ns = new NativeFunction(m.findExportByName('il2cpp_class_get_namespace'), 'pointer', ['pointer']);
    var cls_methods = new NativeFunction(m.findExportByName('il2cpp_class_get_methods'), 'pointer', ['pointer', 'pointer']);
    var m_name = new NativeFunction(m.findExportByName('il2cpp_method_get_name'), 'pointer', ['pointer']);

    var dom = domain_get(), sz = Memory.alloc(8), asms = get_asms(dom, sz), n = sz.readU64().toNumber();
    line('程序集 ' + n + ' 个，目录 ' + dir);
    var KW = /login|logon|auth|account|sdk|platform|user|token/i;
    var hits = 0;
    for (var i = 0; i < n; i++) {
      var img = asm_img(asms.add(i * Process.pointerSize).readPointer());
      var an = img_name(img).readUtf8String();
      if (an !== 'Assembly-CSharp.dll') continue;
      var cc = img_class_count2(img);
      line('Assembly-CSharp 类型数 = ' + cc);
      for (var c = 0; c < cc; c++) {
        var k = img_class(img, c);
        if (k.isNull()) continue;
        var cn = cls_name(k).readUtf8String(), ns = cls_ns(k).readUtf8String();
        var full = (ns ? ns + '.' : '') + cn;
        if (KW.test(full)) {
          var ms = [], iter = Memory.alloc(8); iter.writePointer(ptr(0));
          var mm; var guard = 0;
          while (guard++ < 400) {
            mm = cls_methods(k, iter);
            if (mm.isNull()) break;
            var mn = m_name(mm).readUtf8String();
            if (KW.test(mn) || /init|start|check/i.test(mn)) ms.push(mn);
          }
          line('★ ' + full + ' :: ' + ms.slice(0, 25).join(', '));
          hits++;
          if (hits > 120) break;
        }
      }
      break;
    }
    line('命中类型 ' + hits + ' 个，结束');
  }
  JSON.stringify({ ok: true, dir: dir });
})();
