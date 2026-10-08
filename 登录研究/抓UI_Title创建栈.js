/* 打印「创建 UI_Title」时的调用栈 → 找出是谁触发了跳转主菜单 */
(function () {
  var F = null;
  try {
    var ctx = Java.use('android.app.ActivityThread').currentApplication();
    var d = ctx.getExternalFilesDir(null);
    F = Java.use('java.io.FileOutputStream').$new(Java.use('java.io.File').$new(d, 'dsha_stack.log'), true);
  } catch (e) {}
  function line(m) { try { if (F) { F.write(Java.use('java.lang.String').$new('[' + new Date().toISOString() + '] ' + m + '\n').getBytes('UTF-8')); F.flush(); } } catch (e) {} }
  function ilstr(p) { try { if (!p || p.isNull()) return null; var l=p.add(0x10).readS32(); if(l<=0||l>400) return null; var s=''; for(var i=0;i<l;i++) s+=String.fromCharCode(p.add(0x14+i*2).readU16()); return s.replace(/[^\x20-\x7e\u4e00-\u9fff]/g,'.'); } catch(e){ return null; } }
  var mod = Process.findModuleByName('libil2cpp.so');
  function ex(n, r, a) { var p = mod.findExportByName(n); return p ? new NativeFunction(p, r, a) : null; }
  var dg = ex('il2cpp_domain_get','pointer',[]);
  var ga = ex('il2cpp_domain_get_assemblies','pointer',['pointer','pointer']);
  var ai = ex('il2cpp_assembly_get_image','pointer',['pointer']);
  var inn = ex('il2cpp_image_get_name','pointer',['pointer']);
  var icc = ex('il2cpp_image_get_class_count','ulong',['pointer']);
  var ic = ex('il2cpp_image_get_class','pointer',['pointer','ulong']);
  var cn = ex('il2cpp_class_get_name','pointer',['pointer']);
  var cm = ex('il2cpp_class_get_methods','pointer',['pointer','pointer']);
  var mn = ex('il2cpp_method_get_name','pointer',['pointer']);
  var ta = ex('il2cpp_thread_attach','pointer',['pointer']);
  var dom = dg(); try { ta(dom); } catch (e) {}
  var sz = Memory.alloc(8), asms = ga(dom, sz), n = sz.readU64().toNumber();
  line('==== p38 抓 UI_Title 创建栈 ' + new Date().toISOString() + ' ====');
  var hooked = 0;
  for (var i = 0; i < n; i++) {
    var img = ai(asms.add(i*Process.pointerSize).readPointer());
    if (inn(img).readUtf8String().indexOf('Assembly-CSharp') < 0) continue;
    var cc = icc(img);
    for (var c = 0; c < cc; c++) {
      var k = ic(img, c); if (k.isNull()) continue;
      if (cn(k).readUtf8String() !== 'UI_Title') continue;
      var mi = Memory.alloc(8); mi.writePointer(ptr(0)); var mm, g = 0;
      while (g++ < 60) {
        mm = cm(k, mi); if (mm.isNull()) break;
        var nm = mn(mm).readUtf8String();
        if (!/ctor|ConstructFromXML|CreateInstance/.test(nm)) continue;
        var code = null; try { code = mm.readPointer(); } catch (e) {}
        if (!code || code.isNull()) continue;
        (function (full, addr) {
          try {
            Interceptor.attach(addr, {
              onEnter: function () {
                /* 用 Frida 的调用栈回溯：找返回地址落在 libil2cpp 的帧，映射到最近的符号（没有符号就打印地址） */
                line('▶ 创建 ' + full + ' —— 调用栈（由内向外）：');
                try {
                  var frames = Thread.backtrace(this.context, Backtracer.ACCURATE);
                  for (var fi = 0; fi < Math.min(frames.length, 14); fi++) {
                    var a = frames[fi];
                    var sym = '';
                    try { var s = DebugSymbol.fromAddress(a); if (s && s.name) sym = s.name; } catch (e) {}
                    var r = Process.findRangeByAddress(a);
                    line('     #' + fi + ' ' + a + (sym ? ('  ' + sym) : '') + (r && r.file ? ('  [' + r.file.path.split('/').pop() + ']') : ''));
                  }
                } catch (e) { line('     取栈失败 ' + e); }
              }
            });
            hooked++;
          } catch (e) {}
        })('UI_Title.' + nm, code);
      }
    }
  }
  line('已挂 ' + hooked + ' 个');
  line('==== 就绪：请重新登录一次（或退出重新进）====');
  'ok';
})();
