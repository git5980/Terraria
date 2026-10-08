/* 抓「登录成功 → 主菜单」的跳转链路：
   ① XDSDKHandler 全部方法（含 4 个回调 b__6_*）
   ② LaunchManager 的启动/场景方法
   ③ 国服登录面板 UI_LoginPanel 与 UI_Title
   ④ UnityEngine.SceneManager.LoadScene（场景切换=跳转时刻）
   全部记录调用顺序 + 参数，用于找出"是谁把界面推到主菜单的" */
(function () {
  var F = null;
  try {
    var ctx = Java.use('android.app.ActivityThread').currentApplication();
    var d = ctx.getExternalFilesDir(null);
    F = Java.use('java.io.FileOutputStream').$new(Java.use('java.io.File').$new(d, 'dsha_flow.log'), true);
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
  var cns = ex('il2cpp_class_get_namespace','pointer',['pointer']);
  var cm = ex('il2cpp_class_get_methods','pointer',['pointer','pointer']);
  var mn = ex('il2cpp_method_get_name','pointer',['pointer']);
  var ta = ex('il2cpp_thread_attach','pointer',['pointer']);
  var dom = dg(); try { ta(dom); } catch (e) {}
  var sz = Memory.alloc(8), asms = ga(dom, sz), n = sz.readU64().toNumber();
  line('==== 抓跳转链路 ' + new Date().toISOString() + ' pid=' + Process.id + ' ====');
  /* 目标类清单 + 方法过滤 */
  var PLAN = [
    { cls: /^XDSDKHandler$/,   m: /.*/ },
    { cls: /^LaunchManager$/,  m: /Awake|Start|PlayNext|LoadScene|OnSplashEnd|CheckVersion|reset/i },
    { cls: /^UI_LoginPanel$/,  m: /.*/ },
    { cls: /^UI_Title$/,       m: /.*/ },
    { cls: /^SDKManager$/,     m: /.*/ },
    { cls: /^SceneManager$/,   m: /LoadScene|SetActiveScene|LoadSceneAsync/i },
    { cls: /^GUIMainMenu$/,    m: /.*/ }
  ];
  var hooked = 0, skipped = 0;
  for (var i = 0; i < n; i++) {
    var img = ai(asms.add(i*Process.pointerSize).readPointer());
    if (inn(img).readUtf8String().indexOf('Assembly-CSharp') < 0) continue;
    var cc = icc(img);
    for (var c = 0; c < cc; c++) {
      var k = ic(img, c); if (k.isNull()) continue;
      var kn = cn(k).readUtf8String(), kns = cns(k).readUtf8String();
      var plan = null;
      for (var p = 0; p < PLAN.length; p++) {
        if (PLAN[p].cls.test(kn)) { plan = PLAN[p]; break; }
        /* UI_LoginPanel 全名是 BasePanel.BasePanel.UI_LoginPanel */
        if (PLAN[p].cls.source.indexOf('UI_LoginPanel') >= 0 && kn === 'UI_LoginPanel') { plan = PLAN[p]; break; }
      }
      if (!plan) continue;
      var mi = Memory.alloc(8); mi.writePointer(ptr(0)); var mm, g = 0;
      while (g++ < 300) {
        mm = cm(k, mi); if (mm.isNull()) break;
        var nm = mn(mm).readUtf8String();
        if (!plan.m.test(nm)) { skipped++; continue; }
        var code = null; try { code = mm.readPointer(); } catch (e) {}
        if (!code || code.isNull()) continue;
        (function (full, addr) {
          try {
            Interceptor.attach(addr, {
              onEnter: function (a) {
                var parts = [];
                for (var j = 0; j < 4; j++) {
                  var s = ilstr(a[j]);
                  if (s) parts.push('arg' + j + '="' + s.slice(0, 200) + '"');
                  else if (a[j] && !a[j].isNull()) parts.push('arg' + j + '=' + a[j]);
                }
                line('▶ ' + full + (parts.length ? '  ' + parts.join(' ') : ''));
                this.f = full;
              },
              onLeave: function (r) { line('  ↳ ' + this.f); }
            });
            hooked++;
          } catch (e) {}
        })((kns ? kns + '.' : '') + kn + '.' + nm, code);
      }
    }
  }
  line('已挂 ' + hooked + ' 个方法（跳过 ' + skipped + ' 个不关心的方法）');
  line('==== 就绪：请正常登录（TapTap 授权），我会记录跳转链路 ====');
  'ok';
})();
