# 泰拉瑞亚物品图标（从安装包提取 → 菜单里显示）

> 状态：**已打通并上线**。图集已解码，`物品ID → 图集矩形` 映射表已离线解析出来（6085 件），
> 菜单「添加物品」已改成 **4 列图标网格**（下图是实机运行截图里的效果：村正大刀 / 链球 / 蓝月 / 草剑 / 荆棘旋刃… 图标与名字一一对应）。

---

## 一、结论先行（最关键的三条）

1. **图集矩形表本身就序列化在 APK 里**，不需要运行时去问游戏：
   `resources.assets` 偏移 **18755426** 起，`int32 条数 = 6230`，紧跟 **6230 条 × 22 字节**的记录，
   **按 key 升序**排列（可直接二分）。

   | 字段 | 类型 | 说明 |
   |---|---|---|
   | `key` | int32 | `int32(CRC32("item_<id>.png"))`，负数表示该哈希高位为 1 |
   | `AtlasIndex` | int32 | 0 = `Item1`(2048²)，1 = `Item2`(2048²) |
   | `TextureWidth` / `TextureHeight` | int16 ×2 | 图标实际像素 |
   | `TextureOffsetX` / `TextureOffsetY` | int16 ×2 | 图集内偏移 |
   | `TextureScale` | int16 | 实测恒为 1 |
   | `TileDataOffset` | int32 | 实测恒为 −1 |

   另一份同样的表在偏移 **3042920**（`Item` 的低清 1024 版，6229 条，坐标是另一套打包）。

2. **物品 ID → key 是 CRC32，不是普通字符串哈希**：
   `key = int32(zlib.crc32(("item_%d.png" % id).encode()))`。
   小写 `item_`、后缀 `.png` 一个都不能错。**已用运行时真值验证 26/26 全中**
   （对照 `TextureAssets.Item[id].Value.PackedEntry.TextureId` 与矩形）。

3. **图集 PNG 已修正为正向**（2026-09-20，见 `修正图集.py`）：裁剪矩形直接用 `(X, Y, X+W, Y+H)`。
   旧版图集有两个坑 —— Unity 纹理**自下而上**存（写出 PNG 时没逐行翻转 → 整幅上下镜像）、
   字节序是 **BGRA**（当成 RGBA 写 → 红蓝互换）。表现：**物品图标倒立、金币发蓝**。
   旧文档里「把 y 换成 图高−Y−H」只把图块的**位置**找对了，内容仍是倒的 ——
   当时用铁阔剑/铁锤这类上下近似对称的图标验证所以没看出来，
   换成**药水瓶（瓶口朝上）/ 金币（金色）**立刻暴露。

---

## 二、素材与提取（可复现）

`图集/` 下是从 APK 抠出并解码成 PNG 的物品图标图集（内容已肉眼确认）：

| 文件 | 尺寸 | 资源名 | 压缩格式 |
|---|---|---|---|
| `atlas_Item1_2048x2048.png` | 2048² | `Item1` | ASTC_RGB_5x5 |
| `atlas_Item2_2048x2048.png` | 2048² | `Item2` | ASTC_RGB_5x5 |
| `atlas_Item1_1024x1024.png` | 1024² | `Item1`（低清版） | ASTC_RGB_5x5 |
| `atlas_Item2_1024x1024.png` | 1024² | `Item2`（低清版） | ASTC_RGB_5x5 |
| `atlas_Item3_1024x1024.png` | 1024² | `Item3` | ASTC_RGB_5x5 |

1. **素材位置**：APK 里没有图片文件，全在 `assets/bin/Data/data.unity3d`
   （`UnityFS` v8 / Unity **2021.3.26f1c1** / **LZ4** 分块压缩）。`resources.resource` 是 **FSB5（FMOD 音频）**，不是贴图。
2. **解包**（`extract_bundle.py`）—— 两个对齐坑，**都踩过**：
   - UnityFS 版本 ≥7：块信息前要**对齐到 16 字节**；
   - 数据块区起点 = 头部+块信息之后**再对齐到 16 字节**（本包差 7 字节，不修则所有块解压失败）。
   共 12 个节点、608.8 MB；关键是 `resources.assets`(58.8MB 元数据) + `resources.assets.resS`(519.8MB 原始贴图数据)。
3. **解析资源**：UnityPy 1.25 没有 aarch64 wheel，只能用 1.7.43；但本包是**发布版（无类型树）**，1.7.43 读不了对象 →
   **自己写 Texture2D 解析器**（`unity_tex.py`，Unity 2021 布局，注意 **bool 组补齐到 4 字节**）。
4. **解码**：`texture2ddecoder.decode_astc(data, w, h, 5, 5)` → Pillow 存 PNG。

依赖是**直接下载 wheel 解包**到 `/root/DshaWorks/pylibs`（没走 pip，没动系统环境）：
`lz4 / brotli / Pillow / texture2ddecoder / etcpak / fmod_toolkit / fsspec / attrs / tabulate / UnityPy==1.7.43` + 一个 `tkinter.messagebox` 桩。

---

## 三、完整流水线（改游戏版本后重跑即可）

```bash
cd "/sdcard/Download/DSHA/泰拉瑞亚项目/物品图标"

# ① 安装包 → 两张图集 PNG（图集/）+ 物品矩形表（物品矩形表.json / .txt）
#    顺带把两张 2048 图集复制到 /sdcard/Download/DSHA/terraria_icons/atlas_{0,1}.png
PYTHONPATH=/root/DshaWorks/pylibs python3 构建图标表.py

# ② 把矩形表压成 9 字符/件 的字符串块，写回 控制面板/系统菜单.js 的 ICON_TABLE
python3 注入图标表.py --write

# ③ 下发菜单（图标随菜单一起生效）
cd ../控制面板 && python3 jshook.py exec --file 系统菜单.js --wait 3
```

`构建图标表.py` 顶部三个常量按需改：`ASSETS`（resources.assets 路径）、`DB_OFFSET`（表偏移）、`PAGES`（页号→PNG 文件名）。

### 矩形表编码（`ICON_TABLE`）

每个物品固定 **9 个字符**，字符表 = base64url 的 64 个字符（`A-Za-z0-9-_`）：
`[图集页 1][X 2][Y 2][宽 2][高 2]`，每个数 = 高低各 6 位（`v = c0*64 + c1`）。
全 0（`AAAAAAAAA`）表示该 ID 没有图集图标。6085 件 × 9 = 54.8 KB 文本，直接内嵌，运行时零依赖。

---

## 四、图标怎么进游戏进程（三条通道，按顺序）

游戏是 `targetSdk=30`，Android 16 上 **`/sdcard` 直接被分区存储挡住**
（实测 `File.exists()=true` 但 **`canRead()=false`，`decodeFile` 返回 null**；
`PRIVATE_FLAG_REQUEST_LEGACY_EXTERNAL_STORAGE` 对 targetSdk 30 无效）。所以：

| 顺序 | 通道 | 说明 |
|---|---|---|
| ① | **游戏私有缓存** `/data/user/0/com.xd.terraria/cache/dsha_atlas_N.png` | 一次写入、永久可用，**日常走这条** |
| ② | **本地 HTTP** `http://127.0.0.1:8899/atlas_N.png` | 缓存没有时由 `ICON.warm()` 在**后台线程**拉取并写入 ①；服务见 `图标HTTP服务.py` |
| ③ | 直接 `decodeFile('/sdcard/.../terraria_icons/atlas_N.png')` | 本机不可用，留给别的机型/版本 |

三条都拿不到时，选择物品**自动退回纯文字列表**，功能不受影响。

⚠️ 两个必须记住的坑：
- **网络不能在主线程做**：弹层是在主线程建的，主线程 `openStream()` 会抛
  `android.os.NetworkOnMainThreadException` → 所以下载全部放在 `ICON.warm()`（Frida 脚本线程，`setTimeout`），
  主线程只做本地 `decodeFile`。
- **Frida 的 `Java.array('byte', N)` 不支持「按长度建数组」**（报 `Error: expected an integer`），
  要用 `Java 9+` 的 `InputStream.readAllBytes()`；不可用时退回 `decodeStream` + `bitmap.compress(PNG)` 写缓存。

---

## 五、配套脚本

| 文件 | 用途 |
|---|---|
| `构建图标表.py` | 解析 `resources.assets` 里的图集矩形表 → `物品矩形表.json/.txt`，并复制图集到英文路径 |
| `注入图标表.py` | `物品矩形表.json` → `系统菜单.js` 的 `ICON_TABLE`（9 字符/件）；`--write` 直接写回 |
| `图标HTTP服务.py` | 容器内静态服务（端口 8899），只在私有缓存还没建立时需要 |
| `extract_bundle.py` | 从 APK 的 `data.unity3d` 解出指定节点（含两个 16 字节对齐修正） |
| `unity_tex.py` | 手工解析 Unity 2021 `Texture2D` 对象（无类型树时用）；含 `FMT` 格式名表 |
| `物品矩形表.json` / `.txt` | 6085 件物品的 `ID → (页, X, Y, 宽, 高)` |
| `校验_前48个.png` | 前 48 件物品的裁剪校验图（肉眼确认图标正确） |

解包产物在 `/root/DshaWorks/unpack/`（约 856MB）。

---

## 六、历史尝试（走过的弯路，留作记录）

| 尝试 | 结果 |
|---|---|
| 运行时读 `PackedEntry`（偏移 +96） | **可用**，但只能拿到已加载贴图（最终没用它，因为它需要跑游戏；现在答案在 APK 里） |
| 22 字节记录布局暴力搜索（用已知尺寸做约束） | 最高 7/51 = 噪声（当时不知道 key 是 CRC32，样本配不上） |
| 货架式打包模拟 | 裁出来是黑块，假设不成立 |
| `TextureAtlasDB.LoadData(byte[])` / `GetTexture(...)` | `LoadData` 一调就 `breakpoint triggered`（methodPointer 疑似未编译的陷阱桩）；`GetTexture` 返回空 |
| 遍历 Assembly-CSharp 全部类 / 读未初始化静态字段 | **会让 Frida 侧 access violation、脚本静默死掉**，游戏主线程也会被拖住 → **只做定点字段读取** |

**关键转向**：与其继续在运行时猜布局，不如回到 APK 里找数据 —— 结果发现矩形表是**明文序列化**的，
`key` 的分布（6230 个值在 int32 上近似均匀、最小 ≈ 2³¹/6230）一眼就是哈希，
拿 26 个运行时真值做字典攻击，命中 `CRC32("item_<id>.png")`。
