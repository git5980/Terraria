/* 不用 backtrace（那会闪退），改用「时间窗口」法：
   记录 UI_Title 创建时刻前 3 秒内所有 UI/面板/登录相关方法的调用序列，
   创建前最后被调用的那个就是"跳转触发者" */
(function () {
  var F = null, ring = [];
  try {
    var ctx = Java.use('android.app.ActivityThread').currentApplication();
    var d = ctx.getExternalFilesDir(null);
    F = Java.use('java.io.FileOutputStream').$new(Java.use('java.io.File').$new(d, 'dsha_flow2.log'), true);
  } catch (e) {}
  function line(m) { try { if (F) { F.write(Java.use('java.lang.String').$new('[' + new Date().toISOString() + '] ' + m + '\n').getBytes('UTF-8')); F.flush(); } } catch (e) {} }
  var mod = Process.findModuleByName('libil2cpp.so');
  function ex(n, r, a) { var p = mod.findExportByName(n); return p ? new NativeFunction(p, r, a) : null; }
  var dg = ex('il2cpp_domain_get','pointer',[]);
  var ga = ex('il2cpp_domain_get_assemblies','pointer',['pointer','pointer']);
  var ai = ex('il2cpp_assembly_get_image','pointer',['pointer']);
  var inn = ex('il2cpp_image_get_name','pointer',['pointer']);
  var icc = ex('il2cpp_image_get_class_count','ulong',['pointer']);
  var ic = ex('il2cpp_image_get_class','pointer',['pointer','ulong']);
  var cn = ex('il2cpp_class_get_name','pointer',['pointer']);
  var cns = ex('il2cpp_class_get_namespace','pointer',['pointer']);
  var cm = ex('il2cpp_class_get_methods','pointer',['pointer','pointer']);
  var mn = ex('il2cpp_method_get_name','pointer',['pointer']);
  var ta = ex('il2cpp_thread_attach','pointer',['pointer']);
  var dom = dg(); try { ta(dom); } catch (e) {}
  var sz = Memory.alloc(8), asms = ga(dom, sz), n = sz.readU64().toNumber();
  line('==== 抓跳转者 ' + new Date().toISOString() + ' pid=' + Process.id + ' ====');
  var hooked = 0;
  for (var i = 0; i < n; i++) {
    var img = ai(asms.add(i*Process.pointerSize).readPointer());
    if (inn(img).readUtf8String().indexOf('Assembly-CSharp') < 0) continue;
    var cc = icc(img);
    for (var c = 0; c < cc; c++) {
      var k = ic(img, c); if (k.isNull()) continue;
      var kn = cn(k).readUtf8String(), kns = cns(k).readUtf8String();
      var full = (kns ? kns + '.' : '') + kn;
      if (!/UI_|Panel|Login|SDK|Launch|Menu|Scene/i.test(full)) continue;
      var mi = Memory.alloc(8); mi.writePointer(ptr(0)); var mm, g = 0;
      while (g++ < 120) {
        mm = cm(k, mi); if (mm.isNull()) break;
        var nm = mn(mm).readUtf8String();
        if (!/ctor|ConstructFromXML|CreateInstance|Show|Open|Init|Start|Awake|Login|CheckLogin|Switch|Enter|Load/i.test(nm)) continue;
        var code = null; try { code = mm.readPointer(); } catch (e) {}
        if (!code || code.isNull()) continue;
        (function (name, addr) {
          try {
            Interceptor.attach(addr, { onEnter: function () {
              var now = Date.now();
              ring.push({ t: now, n: name });
              if (ring.length > 60) ring.shift();
              if (/UI_Title/.test(name)) {
                line('▲ 主菜单被创建：' + name);
                line('   —— 之前 3 秒内的调用序列（越靠后越接近触发点）——');
                var lim = now - 3000;
                for (var x = 0; x < ring.length; x++) if (ring[x].t >= lim) line('    ' + (ring[x].t - lim) + 'ms  ' + ring[x].n);
              }
            } });
            hooked++;
          } catch (e) {}
        })(full + '.' + nm, code);
      }
    }
  }
  line('已挂 ' + hooked + ' 个观测点（不取栈）');
  line('==== 就绪：请重启游戏后正常登录 ====');
  'ok';
})();
