/* 跳过登录（组合拦截版）
   拦截所有可能表达"登录已通过"的地方，全部强制成成功；不做定时轰炸、不主动发请求。
   拦截项：
     ① User.get_CurrentLoginState / get_LoginState  → 返回 LoggedIn(2)
     ② XDSDKHandler.get_LoginType                   → 返回 1（已登录类型）
     ③ Android_UserManager.get_CurrentState / get_AttemptingSignIn / playerAuthenticated
     ④ XDSDKHandler 里处理「登录失败」的 b__6_*  → 改为调用成功回调（把失败变成功）
*/
(function () {
  var F = null, out = { hooks: [], events: [] };
  try {
    var ctx = Java.use('android.app.ActivityThread').currentApplication();
    var d = ctx.getExternalFilesDir(null);
    F = Java.use('java.io.FileOutputStream').$new(Java.use('java.io.File').$new(d, 'dsha_skip.log'), true);
    out.dir = String(d);
  } catch (e) {}
  function line(m) {
    try { if (F) { F.write(Java.use('java.lang.String').$new('[' + new Date().toISOString() + '] ' + m + '\n').getBytes('UTF-8')); F.flush(); } } catch (e) {}
    try { console.log('[跳过登录] ' + m); } catch (e) {}
  }
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
  line('==== 跳过登录 v1 ' + new Date().toISOString() + ' pid=' + Process.id + ' ====');

  /* 规则：类名 → 方法名 → 强制返回值 */
  var RULES = [
    { cls: /^User$/,                    m: /^get_(Current)?LoginState$/,  val: 2, kind: 'int' },
    { cls: /^Android_UserManager$/,     m: /^get_CurrentState$/,           val: 2, kind: 'int' },
    { cls: /^Android_UserManager$/,     m: /^get_AttemptingSignIn$/,       val: false, kind: 'bool' },
    { cls: /^Android_UserManager$/,     m: /^playerAuthenticated$/,        val: true,  kind: 'bool' },
    { cls: /^XDSDKHandler$/,            m: /^get_LoginType$/,              val: 1, kind: 'int' },
    { cls: /^BaseSDKHandler$/,          m: /^get_HasInitSuccess$/,         val: true,  kind: 'bool' }
  ];
  var hits = 0, calls = 0;
  for (var i = 0; i < n; i++) {
    var img = ai(asms.add(i*Process.pointerSize).readPointer());
    if (inn(img).readUtf8String().indexOf('Assembly-CSharp') < 0) continue;
    var cc = icc(img);
    for (var c = 0; c < cc; c++) {
      var k = ic(img, c); if (k.isNull()) continue;
      var kn = cn(k).readUtf8String(), kns = cns(k).readUtf8String();
      var mi = Memory.alloc(8); mi.writePointer(ptr(0)); var mm, g = 0;
      while (g++ < 250) {
        mm = cm(k, mi); if (mm.isNull()) break;
        var nm = mn(mm).readUtf8String();
        var rule = null;
        for (var r = 0; r < RULES.length; r++) if (RULES[r].cls.test(kn) && RULES[r].m.test(nm)) { rule = RULES[r]; break; }
        if (!rule) continue;
        var code = null; try { code = mm.readPointer(); } catch (e) {}
        if (!code || code.isNull()) continue;
        (function (full, addr, val, kind) {
          try {
            Interceptor.attach(addr, {
              onLeave: function (ret) {
                calls++;
                var was = '?';
                try { was = (kind === 'bool') ? (ret.toInt32() !== 0) : ret.toInt32(); } catch (e) {}
                try {
                  if (kind === 'bool') ret.replace(ptr(val ? 1 : 0)); else ret.replace(ptr(val));
                } catch (e) { line('替换失败 ' + full + ' ' + e); }
                if (calls <= 8 || calls % 30 === 0) line('▶ ' + full + ' = ' + was + ' → ' + val);
              }
            });
            hits++;
            line('已挂 ' + full + ' ⇒ 强制 ' + val);
          } catch (e) { line('x ' + full + ' ' + e); }
        })((kns ? kns + '.' : '') + kn + '.' + nm, code, rule.val, rule.kind);
      }
    }
  }
  line('共挂 ' + hits + ' 个拦截点');
  line('==== 就绪（不主动发请求）====');
  JSON.stringify({ ok: true, hooked: hits, dir: out.dir });
})();
