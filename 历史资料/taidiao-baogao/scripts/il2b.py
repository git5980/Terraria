import sys; sys.path.insert(0,'/tmp')
import js, json, time

PRELUDE = r"""
var m = Process.findModuleByName('libil2cpp.so');
function F(n, ret, args){ try { return new NativeFunction(m.getExportByName(n), ret, args); } catch(e){ return null; } }
function P(n){ var a=[]; for(var i=0;i<n;i++) a.push('pointer'); return a; }
var A = {
  domain_get:  F('il2cpp_domain_get','pointer',P(0)),
  thread_attach:F('il2cpp_thread_attach','pointer',P(1)),
  get_asms:    F('il2cpp_domain_get_assemblies','pointer',P(2)),
  asm_img:     F('il2cpp_assembly_get_image','pointer',P(1)),
  img_name:    F('il2cpp_image_get_name','pointer',P(1)),
  cfn:         F('il2cpp_class_from_name','pointer',P(3)),
  cfields:     F('il2cpp_class_get_fields','pointer',P(2)),
  fname:       F('il2cpp_field_get_name','pointer',P(1)),
  foffset:     F('il2cpp_field_get_offset','uint32',P(1)),
  cfield:      F('il2cpp_class_get_field_from_name','pointer',P(3)),
  static_get:  F('il2cpp_field_static_get_value','void',P(3)),
  static_set:  F('il2cpp_field_static_set_value','void',P(2)),
  arrlen:      F('il2cpp_array_length','uint32',P(1)),
  obj_new:     F('il2cpp_object_new','pointer',P(1)),
  mfromname:   F('il2cpp_class_get_method_from_name','pointer',['pointer','pointer','int']),
  mname:       F('il2cpp_method_get_name','pointer',P(1)),
  runtime_invoke: F('il2cpp_runtime_invoke','pointer',P(4)),
  class_init:  F('il2cpp_runtime_class_init','void',P(1)),
  str_new:     F('il2cpp_string_new','pointer',P(1))
};
function gameImage(){
  var domain = A.domain_get(); var cp = Memory.alloc(8);
  var asms = A.get_asms(domain, cp); var n = cp.readU32();
  for (var i=0;i<n;i++){
    var a = asms.add(i*Process.pointerSize).readPointer();
    var im = A.asm_img(a);
    if (A.img_name(im).readUtf8String() === 'Assembly-CSharp.dll') return im;
  }
  return null;
}
function findClass(ns, name){
  var img = gameImage(); if (!img) return null;
  var c = A.cfn(img, Memory.allocUtf8String(ns), Memory.allocUtf8String(name));
  return (c && !c.isNull()) ? c : null;
}
function ensureThread(){ try { A.thread_attach(A.domain_get()); } catch(e){} }
"""

def fresh(code, wait=6, tail=40):
    js.call("frida_unload",{"package":"com.xd.terraria"}); time.sleep(0.9)
    r = js.run(code); time.sleep(wait)
    return r, js.log(tail).get('lines',[])
