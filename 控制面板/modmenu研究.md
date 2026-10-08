# JsHook modmenu 框架研究

> 结论来源：**JsHook 官方文档**（`https://doc.jshook.org`，docsify 站点，markdown 源已存档到 `官方API文档/`）+ 本机实测。
> 只使用 JsHook 自己提供的 API，不依赖任何第三方框架。

## 一、框架定位

`modmenu` 是 JsHook 注入环境里的**悬浮菜单 API，底层用 ImGui 实现**（官方原话：*"这是一个mod菜单…该接口使用imgui实现，可以创建多个悬浮窗实例"*）。

同族 API：

| API | 用途 | 实例方法 |
|---|---|---|
| `modmenu` | 悬浮菜单（可交互控件） | `close() state() size(w,h) position(type,x,y) icon(img) edgeHiden(b) update(id,val)`，静态 `closeAll()` |
| `moddraw` | 叠加绘制（线/矩形/文字/图片） | `line() rect() text() image() close()`，静态 `closeAll()` |
| `canvas` | 全屏画板（ondraw 返回 Bitmap） | `close() maxfps(fps)`，静态 `closeAll()` |
| `view` | 找 View / 取坐标 / 主线程执行 | `findViewByText(t) getPosition(v) findViewPositionByText(t) runOnUiThread(fn)` |
| `dialog` | 输入框对话框 | `dialog.input(title, {ok,cancel}, content)` |

**渲染位置**：不在游戏进程。菜单通过 Binder 交给 JsHook 应用侧的
`me.jsonet.service.JsHookModMenuService` / `JsHookImguiModMenuService`，
最终由 **root 守护进程 `me.jsonet.jshook:root:daemon`** 的 `DaemonModMenu` 画出来。

## 二、`modmenu.create(title, options, callback)`

- `title`: string — 悬浮窗标题
- `options`: **数组**，每个元素是一个控件对象（见下表）
- `callback`: `{ onchange: function(result){...} }` — `result.id` 是触发控件的 id

### 控件类型表（官方 schema）

| type | 字段 | 说明 |
|---|---|---|
| `category` | `title` | 分组标题 |
| `text` | `val` `size` `color` | 纯文本（`size` px，`color` 如 `#FF0000`） |
| `switch` | `title` `val`(bool) | 开关 |
| `checkbox` | `title` `val`(bool) | 复选框 |
| `button` | `title` | 按钮（点击触发回调） |
| `slider` | `title` `val` `min` `max` | 滑块 |
| `input` | `title` `val` | 输入框 |
| `radio` | `title` `item`(数组) `val`(索引) | 单选 |
| `select` | `item`(数组) `val`(索引) | 下拉选择 |
| `collapse` | `title` `item`(子控件数组) `default`(bool) | 折叠分组 |
| `tab` | `item`=[{`title`,`item`:[…]}] `default`(索引) | 多标签页 |
| `image` | `width` `height` `val`(url/base64) | 图片 |
| 任意控件 | `id` | **自定义唯一 id**，回调里用 `result.id` 判断是谁触发的 |

### 回调

```javascript
modmenu.create('测试', [
  { type:'switch', id:'god', title:'上帝模式', val:false },
  { type:'button', id:'heal', title:'回满血' }
], {
  onchange: function (result) {
    // result = { id:'god', val:true } 之类
    switch (result.id) { case 'god': ...; case 'heal': ...; }
  }
});
```

### 实例方法（官方）

| 方法 | 作用 |
|---|---|
| `close()` | 关闭这个菜单实例 |
| `state()` | 在悬浮窗底部显示 ImGui 状态栏（**不是**读状态） |
| `size(w,h)` | 调整窗口大小（px） |
| `position(type,x,y)` | 默认位置，type=1..9 对应九宫格 |
| `icon(img)` | 设置悬浮图标（base64 或 url） |
| `edgeHiden(b)` | 图标拖到屏幕边缘自动隐藏（默认关） |
| `update(id, val)` | **动态改某个控件的值**（用来同步界面） |
| `modmenu.closeAll()` | 关闭所有菜单（**只对当前脚本会话有效**） |

## 三、实测踩坑（都是真金白银）

1. **字段名记牢**：是 `title` / `val`，不是 `name` / `value`；滑块叫 `slider`，不叫 seekbar。
   用错名字**不会报错**，只会得到一个**空白菜单** + 一个悬浮图标。
2. **生命周期铁律**：菜单活在守护进程里，`closeAll()` 关不掉**之前脚本会话**建的菜单。
   跨会话残留的图标 `closeAll`、`imgui_clear`、杀进程、视图树摘除**全都无效**，只能手动清
   （点图标/长按删除、JsHook 里关守护进程、或重启手机 / 退出游戏）。
   → **规矩：创建后必须在同一会话里 `close()`**（测试时用 `CFG.autoCloseSec` 定时自动关）。
3. **菜单归守护进程**：`am force-stop me.jsonet.jshook` 只杀主进程，守护进程不受影响；
   JsHook 自己的 shell 也拒绝杀它（`[安全拦截] 禁止杀死 daemon 进程`）。
4. **不含模板文件**：APK 里没有 modmenu 示例脚本；选项 schema 只能从官方文档拿（本次已存档）。
5. **onchange 只在交互时触发**，不会主动回报初始状态；需要同步界面用 `update(id, val)`。
6. `moddraw` 的 draw 回调里**不要写耗时逻辑**（官方明确警告会拖慢渲染），数据在外面算好。

## 三·补、回调线程的重大坑（实测）

**现象**：菜单能点、回调也进来了，但凡是**调用游戏方法**的动作都崩：
`处理菜单事件出错：Error: access violation accessing 0x10`；而**写静态字段**的动作（如血月）正常。

**根因**：`onchange` 回调跑在 **JsHook 的 Binder/ImGui 线程**上，该线程**没有 attach 到 il2cpp 运行时**，
于是 `il2cpp_runtime_invoke` 一进入就踩空（NULL+0x10）；`il2cpp_field_static_set_value` 不走运行时所以没事。

**修法**：回调入口先 `il2cpp_thread_attach(domain)`（可重复调用，开销极小）：
```javascript
onchange: function (res) {
  IL.attach();          // ← 关键
  ... 再执行动作 ...
}
```

**其它实测**：
- 按钮点击回调：`{"id":"p-max","type":"button","val":null}`
- 开关回调：`{"id":"c-speed","type":"switch","val":true}`
- 脚本 `console.log` 会同时进 **logcat（tag `jshook_frida`）**，可用 `logcat -d | grep jshook_frida` 排查；
  `frida_read_log` 只返回**上次重置之后**的新输出。
- **重跑脚本会卸载当前会话 → 菜单还在但回调失效**。要用菜单就别重发脚本；改了代码就重新创建菜单（先 `close()` 旧的）。

## 三·补 2、反馈通道（实测：游戏聊天接口不可用）

- **`Main.NewText(string, Color)` 在本移植版抛 `System.NullReferenceException`**：
  两个重载（/2 `(String,Color)`、/4 `(String,Byte,Byte,Byte)`）、脚本线程与主线程（`Java.scheduleOnMainThread`）
  **全部抛 NRE**，而 `Main.chatMonitor` 非空、世界已加载（`worldName="鸟之弥撒"`）。
  → **不要指望用它做游戏内提示**。
- ✅ **可用做法：菜单自带状态栏**。加一个 `{type:'text', id:'status', val:'就绪'}` 控件，
  用 `menu.update('status', '满配已生效')` 回显（实测有效，控件文字会实时刷新）。
  ⚠️ **`update()` 会反过来触发一次 `onchange`**（日志实证：`onchange {"id":"status","type":"text","val":"…"}`），
  所以派发器里必须**显式忽略 `status`**，否则会形成回显循环。
- ✅ **可用做法：`console.log` → logcat**（tag `jshook_frida`），我这边能直接读。
- 其它可选的可见反馈：`moddraw.text`（ImGui 叠加绘制）、`canvas`（Bitmap 自绘）。

## 三·补 3、自清理写法（避免叠图标）

菜单句柄挂在 `globalThis` 上**跨脚本会话仍在**，所以脚本开头可以先收尾上次的：
```javascript
try { if (globalThis.TERRARIA_MENU && globalThis.TERRARIA_MENU.close) globalThis.TERRARIA_MENU.close(); } catch (e) {}
menu = modmenu.create(...);
globalThis.TERRARIA_MENU = menu;
```

## 三·补 4、输入穿透问题（重要，含一次失败实验）

**现象**：点/拖菜单时，下面的游戏（甚至系统界面/其它 App）也会收到同一次触摸。

**根因**：JsHook 的悬浮菜单是「只读输入」的覆盖层——它读得到触摸，但**从不消费事件**。
菜单显示在系统层，触摸照常送到下层窗口。实测日志：同一次触摸里
`Activity.dispatchTouchEvent` 与 `UnityEngine.Input.get_touchCount=1` 同时出现。

**❌ 失败实验（别重试）**：在 Java 层 `Activity.dispatchTouchEvent` 直接 `return true` 吞掉触摸
→ **游戏闪退**。不要从 Java 事件流里截断输入。

**✅ 现有保守方案（`游戏内菜单.js` 的「面板模式」开关）**：
钩 `UnityEngine.Input.get_touchCount`，开启时 `ret.replace(0)` —— **只改一个返回值，不动事件流**。
效果：面板模式下**游戏**收不到触摸（拖动/点按钮不会误操作游戏）；关掉即恢复；60 秒无面板操作自动关闭兜底。
**局限**：只对游戏生效；面板盖在系统界面/其它 App 上仍会点穿——这是框架的覆盖层设计，JS 侧无法改变。

## 四、我们据此写的脚本

`控制面板/游戏内菜单.js`（340 行）——用官方 schema 写的泰拉瑞亚面板：

- **角色**：读属性 / 满配 / 回满血 / 清减益 / 改经典难度 + 4 个持续开关（持续加成、上帝模式、飞行、加速跑、幸运）
- **事件**：血月、日食、下雨、沙尘暴（开关）+ 哥布林/海盗/火星入侵、派对、灯笼夜、停止全部（按钮）
- **武器**：读选中武器 / 伤害+50 / 必暴 / 快挥 / 恢复原厂（**只改背包里当前选中的那一个 Item 实例**）
- 持续效果走 `Player.ResetEffects` 钩子，只对开启的项生效
- `CFG.autoCloseSec` 可设自动关闭时间，避免留下图标

**用法**：JsHook 里对 `com.xd.terraria` 执行本脚本即可；同会话内可用 `TERRARIA_MENU.close()` 手动关。
