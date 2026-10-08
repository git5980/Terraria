# 泰拉瑞亚物品数据库（国服 `com.xd.terraria`）

从**正在运行的游戏进程**里直接导出的全量物品数据，不是从网上抄的表格——数值与你手机上这个版本完全一致。

| 项目 | 值 |
|---|---|
| 游戏 | 泰拉瑞亚 国服 `com.xd.terraria`（Unity + IL2CPP，1.4.4 系移植） |
| 导出设备 | OnePlus PKR110 / Android 16 |
| 导出方式 | JsHook（Frida）注入游戏进程 → il2cpp API 读取 |
| 物品总数 | **6227** 件（ID 区间 1–6265，含 38 个废弃空号） |
| 装备类 | **2041** 件（武器 523 / 饰品 478 / 时装 436 / 护甲 256 / 染料 149 / 工具 116 / 坐骑 67 / 弹药 16） |
| 每件物品 | 原始 141 个字段（繁体中文名、英文标识、伤害、防御、槽位、稀有度、售价、弹幕、增益…） |

---

## 一、文件清单

| 文件 | 内容 | 用途 |
|---|---|---|
| `out/terraria_items_all.json` | 全部 6227 件物品 × 141 字段（约 20 MB） | 最完整的底库，程序读取/备份 |
| `out/terraria_items_all.csv` | 全部物品的常用 32 列（约 0.8 MB） | 用 Excel/WPS 直接看、筛选 |
| `out/terraria_equipment.json` | 2041 件装备（约 6.7 MB） | 只要装备时的底库 |
| `out/terraria_equipment.csv` | 2041 件装备 × 46 列（约 0.3 MB） | **主用表**：改装备数值最顺手 |
| `out/terraria_cn_index.csv` | 中文名 → ID / 英文标识 / 分类 | 速查：想加某件东西先在这查 ID |
| `out/SUMMARY.md` | 分类统计摘要 | 概览 |
| `data/items_full.jsonl` | 游戏原始导出（每行一个物品，约 15 MB） | 原始底稿，重新构建时的输入 |
| `extract_items.js` | Frida/il2cpp 提取脚本 | 游戏更新后重新导出 |
| `build_dataset.py` | 数据加工脚本 | 由 `data/items_full.jsonl` 生成 `out/` 下所有表格 |
| `custom_items.example.json` | 自定义增删改模板 | 以后加/改物品的入口 |

CSV 均为 **UTF-8 带 BOM**，Excel / WPS 双击打开中文不乱码。

---

## 二、数据是怎么取到的

`extract_items.js` 在游戏进程内通过 il2cpp 接口读取，三路合并：

| 数据 | 来源 |
|---|---|
| 物品 ID ↔ 英文标识（如 `4956 = Zenith`） | `Terraria.ID.ItemID` 的 6319 个静态常量 |
| 物品全部属性（伤害/防御/槽位/稀有度…） | `Terraria.Item` 实例：`SetDefaults(id)` 之后逐字段直读 |
| 中文名（天顶剑、泰拉刃…） | `Terraria.Lang.GetItemNameValue(id)`，取游戏当前语言 |

> 关键点：数据来自**运行时**，因此国服自研物品（XD 联动道具等）也在里面，ID 与官方 PC 版不完全对应。

---

## 三、字段速查（装备表）

| 列 | 含义 | 说明 |
|---|---|---|
| `ID` | 物品类型 ID | 游戏内 `Item.type`，写存档/改内存就是它 |
| `中文名` / `英文标识` | 名称 | 英文标识来自 `ItemID` 常量名（Zenith、TerraBlade…） |
| `分类` / `子类` | 工具/武器/护甲/饰品/时装/染料/坐骑/弹药 | 子类如 镐、近战、翅膀、头盔 |
| `伤害` `击退` `暴击%` `使用时间` `使用动画` | 战斗属性 | `使用时间` 越小挥得越快（帧） |
| `防御` | 护甲防御力 | |
| `稀有度值` / `稀有度` | 0 白 1 蓝 2 绿 3 橙 4 浅红 5 粉 6 浅紫 7 青柠 8 黄 9 青紫 10 红 11 深紫 12 彩虹；-11 专家、-13 大师 | 数值为准 |
| `售价(铜)` | 出售价，单位铜币 | 100 铜 = 1 银，10000 铜 = 1 金 |
| `弹幕ID` `弹速` | 射出的弹幕类型与速度 | |
| `弹药ID` `消耗弹药ID` | 作为弹药/消耗何种弹药（0=无） | |
| `魔力消耗` `治疗生命` `治疗魔力` `增益ID` `增益时长` | 药水/魔法相关 | |
| `最大堆叠` | `SetDefaults` 后的堆叠值 | 本移植版多数物品报 9999，实际堆叠由游戏另行限制 |
| `近战/远程/魔法/召唤/哨兵` | 伤害类型标记 | 六类可叠加（如召唤+哨兵） |
| `镐力/斧力/锤力/钓力` | 工具能力 | >0 即该工具 |
| `坐骑ID` | 坐骑类型（0=非坐骑） | |
| `饰品` `时装` `社交` | 布尔标记 | 空=否，是=是 |
| `染料` `涂料` | >0 表示染料/涂料及其槽位 | |
| `自动挥舞` `蓄力` `材料` `可消耗` | 行为标记 | |
| `放置物块` `放置墙` `放置样式` | 放置类物品 | |
| `商店价` | 商店自定义价格（空=按售价） | |

`terraria_items_all.json` 里每件物品有**全部 141 个原始字段**（字段名与游戏内 `Terraria.Item` 字段一致），需要什么直接取。

---

## 四、以后怎么添加 / 修改

### 1) 改现有物品
```bash
cd /sdcard/Download/DSHA/泰拉瑞亚项目/物品库
cp custom_items.example.json custom_items.json
```
在 `items` 数组里写规则（`_格式示例` 里有现成模板）：
```json
{"_op": "patch", "id": 4956, "damage": 250}
{"_op": "patch", "cn": "泰拉刃", "rare": 11}
{"_op": "add", "cn": "我的测试剑", "en": ["MySword"], "category": "武器", "subtype": "近战", "damage": 123}
{"_op": "delete", "id": 1234}
```
然后：
```bash
python3 build_dataset.py
```
`out/` 下的数据集会重新生成（原始 `terraria_items_full_raw.jsonl` 不动，随时可回退）。

> 注意：这是**离线数据表**，改它不会改游戏。要在游戏里生效，需要按 ID 写存档或改内存。

### 2) 加一整批新物品
直接在 `custom_items.json` 里连续写多条 `_op: add`，`id` 可省略（自动取当前最大 ID+1），也可以指定国服尚未使用的空号（见第一节提到的 38 个空号）。

---

## 五、游戏更新后怎么重新导出

1. 打开 **JsHook**，确认 `com.xd.terraria` 在 MCP 目标列表里（`frida_list_targets`），并**启动游戏**（保持运行）。
2. 用 JsHook 的「执行脚本」把 `extract_items.js` 的内容跑起来（脚本顶部 `CONFIG.out` 可改输出路径，默认 `/sdcard/Download/terraria_items_raw.jsonl`）。
3. 脚本会打印进度，结束时输出 `DONE ok=... skipped=... failed=...`。6227 件大约 1–2 分钟，产物约 15 MB。
4. 把导出的 jsonl 放到本目录 `data/items_full.jsonl`，然后：
   ```bash
   python3 build_dataset.py
   ```
   所有表格 + 摘要自动重算（`custom_items.json` 里的自定义规则继续生效）。

---

## 六、已知情况与坑（实测记录）

- **`最大堆叠` 多为 9999**：本移植版 `Item.maxStack` 在 `SetDefaults` 后普遍是 9999（金币=100、心=1、部分国服道具=99/5 这类才有个性值），实际能否堆叠由游戏内逻辑另行决定，别把它当唯一依据。
- **少数国服自研物品没有中文名**：`Lang` 会返回原始 key，例如 `ItemName.XDSpringRocket15`（ID 6264 等），属正常现象。
- **38 个 ID 是空号**：`226, 269–271, 1803–1807, 2772…` 这些是被官方废弃/占位的 ID，`SetDefaults` 后 `type` 不等于自身，已跳过。
- **英文标识别名字段**：`en` 是数组（同一 ID 可能有多个常量名），已过滤掉与物品撞号的国服常量 `XDExtraMusicCount`；`英文标识` 取第一个。
- **稀有度 -11 / -13** 分别是专家 / 大师专属配色。
- **路径权限**（本机实测）：
  - 游戏进程**能写** `/sdcard/Download`，但**读/写不了** `/sdcard/Download/DSHA`（该目录属主是 DSHA 应用，权限 770）→ 所以提取脚本的输出默认走 `Download` 根目录。
  - 游戏私有目录 `/sdcard/Android/data/com.xd.terraria`：设备 shell（root）可读，容器内（本工作区）被 FUSE 拦截。
  - 容器工作区与手机 `/sdcard` 是 bind mount，普通文件可直接双向拷贝。
- **重新导出建议先重启游戏**：JsHook 卸载脚本只重置脚本状态，旧 Hook 仍在进程里；大改脚本后重启游戏最干净。

---

*生成时间：2026-09-16 · 数据来源：本机运行中的 `com.xd.terraria`*

---

## 七、配套：角色属性分析

同项目的 `角色分析/` 目录里放着从游戏里读出来的**当前角色属性报告**与**可执行操作清单**：

| 文件 | 内容 |
|---|---|
| `角色属性分析报告.md` | 角色 偶泥考 的属性逐项分析（生命/防御/伤害/机动/生存）、裸装结论、背包与财富 |
| `角色可用操作.md` | 可对本角色执行的操作清单（持久类 / 每帧持续类 / 方法调用类 + 推荐配方 + 风险） |
| `角色属性摘要.csv` | 关键属性一行一项，便于前后对比 |
| `player_ops.js` | 可执行脚本（默认只读，`CONFIG.enabled=true` 才动手） |
| `http_eval.js` | 让游戏进程从容器 HTTP 服务拉取并执行脚本的引导 |
| `buff_ids.json` / `debuff_ids.json` | 增益 / 减益 ID 表（AddBuff 用） |
| `角色状态快照.json` | 角色 1247 个字段的原始快照 |

---

## 八、配套技能（Agent 侧）

本目录的用法已被固化成一份 **Agent 技能**，装了它的会话会自动知道怎么用 JsHook 操作泰拉瑞亚：

| 项 | 值 |
|---|---|
| Preset | `terraria`（显示名：泰拉瑞亚 · JsHook） |
| 路径 | `/root/.dsh/.agent-presets/terraria/` |
| 技能文件 | `skills/terraria-jshook/SKILL.md`（+ `references/verified-api.md`） |
| 生效方式 | **用它开新会话**；或在设置里把 `agent-presets.default` 改成 `terraria` |

技能内容：环境事实、JsHook 使用规约、IL2CPP 引导模板、数据落盘通道、关键类与字段、三个标准工作流（导出物品库 / 读角色 / 改角色）、已知坑、以及「如何更新本技能」。
以后有新的修改方向，直接改这个 SKILL.md 即可（保持开头 frontmatter 的 name/description）。
