/*
 * ============================================================================
 *  JsHook 引导脚本：从容器本地 HTTP 服务拉取脚本并在游戏进程内执行
 * ============================================================================
 *  为什么需要它：游戏进程读不了 /sdcard/Download 和 Download/DSHA，
 *  所以没法用「放个文件让游戏读」的方式加载脚本；但游戏能连本机回环端口。
 *
 *  前置（在 DSHA 工作区里执行一次，保持后台运行）：
 *      cd "/sdcard/Download/DSHA/泰拉瑞亚项目/角色分析" && nohup python3 -m http.server 8791 --bind 127.0.0.1 &
 *
 *  用法：把下面 PATH 改成要执行的脚本相对路径，然后在 JsHook 里执行本文件内容。
 *  端口若改动，记得同步 PORT_SWAPPED（= 端口高低字节交换后的值）。
 * ============================================================================
 */
var PATH = "/player_ops.js";
var PORT_SWAPPED = 0x5722;   // 8791 = 0x2257 -> 小端写入需交换字节

(function () {
  try {
    var libc = Process.getModuleByName("libc.so");
    function ce(n) { var p = null; try { p = libc.findExportByName(n); } catch (e) {} if (!p) { try { p = libc.getExportByName(n); } catch (e) {} } return p; }
    var socket = new NativeFunction(ce("socket"), "int", ["int", "int", "int"]);
    var connect = new NativeFunction(ce("connect"), "int", ["int", "pointer", "int"]);
    var send = new NativeFunction(ce("send"), "long", ["int", "pointer", "ulong", "int"]);
    var recv = new NativeFunction(ce("recv"), "long", ["int", "pointer", "ulong", "int"]);
    var close = new NativeFunction(ce("close"), "int", ["int"]);

    var fd = socket(2, 1, 0);
    if (fd < 0) { console.log("[!] socket() 失败"); return; }
    var sa = Memory.alloc(16);
    sa.writeU16(2);                       // AF_INET
    sa.add(2).writeU16(PORT_SWAPPED);     // 端口（大端）
    sa.add(4).writeU32(0x0100007f);       // 127.0.0.1
    if (connect(fd, sa, 16) !== 0) { console.log("[!] 连接 127.0.0.1 失败：容器里的 HTTP 服务没起？"); close(fd); return; }

    var req = "GET " + PATH + " HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
    send(fd, Memory.allocUtf8String(req), req.length, 0);

    var cap = 4 * 1024 * 1024, buf = Memory.alloc(cap), total = 0, n;
    while ((n = recv(fd, buf.add(total), 65536, 0)) > 0) { total += n; if (total >= cap) break; }
    close(fd);
    buf.add(total).writeU8(0);
    var text = buf.readUtf8String(total);
    var sep = text.indexOf("\r\n\r\n");
    var body = sep >= 0 ? text.substring(sep + 4) : "";
    var head = sep >= 0 ? text.substring(0, sep).split("\r\n")[0] : "(无响应头)";
    console.log("[HTTP] " + head + "  正文 " + body.length + " 字节");
    if (!body.length) { console.log("[!] 正文为空，检查 PATH：" + PATH); return; }
    var r = eval(body);
    console.log("[*] 执行完成，返回值：" + r);
  } catch (e) { console.log("[!] 引导失败 " + e + "\n" + (e.stack || "")); }
})();
