#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
泰拉瑞亚（国服 com.xd.terraria）物品数据库构建脚本
=====================================================
输入：
  data/items_full.jsonl     由 extract_items.js（Frida/il2cpp）从游戏内导出的原始数据
  custom_items.json         可选：自定义增删改（便于「以后添加、修改」）
输出（out/ 目录）：
  terraria_items_all.json        全部物品（完整字段）
  terraria_items_all.csv         全部物品（常用字段，UTF-8-BOM，可直接用 Excel/WPS 编辑）
  terraria_equipment.json        装备类（武器/护甲/饰品/工具/弹药/坐骑/时装/染料）
  terraria_equipment.csv         装备类（同上，CSV）
  terraria_cn_index.csv          中文名 -> ID 速查表
  SUMMARY.md                     统计摘要

用法：
  python3 build_dataset.py                 # 用 data/items_full.jsonl 构建
  python3 build_dataset.py --raw 其它.jsonl
"""
import argparse
import csv
import json
import os
import sys
from collections import Counter, OrderedDict

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "out")

# 稀有度 -> 中文（数值才是权威，标签仅供阅读；-11 专家 / -13 大师为游戏内特殊色）
RARITY = {
    -13: "大师", -12: "大师", -11: "专家", -1: "灰色",
    0: "白色", 1: "蓝色", 2: "绿色", 3: "橙色", 4: "浅红", 5: "粉色",
    6: "浅紫", 7: "青柠", 8: "黄色", 9: "青紫", 10: "红色", 11: "深紫",
    12: "彩虹", 13: "大师",
}

# 槽位字段 -> 中文名（值 >=0 表示该物品占用此装备槽）
# 注意：voiceSlot 在本移植版里对所有饰品默认就是 0（不是 -1），只能按 >0 判断，否则会污染子类
SLOT_CN = OrderedDict([
    ("headSlot", "头部"), ("bodySlot", "身体"), ("legSlot", "腿部"),
    ("handOnSlot", "手部(显)"), ("handOffSlot", "手部(隐)"), ("backSlot", "背部"),
    ("frontSlot", "身前"), ("shoeSlot", "鞋部"), ("waistSlot", "腰带"),
    ("wingSlot", "翅膀"), ("shieldSlot", "盾牌"), ("neckSlot", "项链"),
    ("faceSlot", "面部"), ("balloonSlot", "气球"), ("beardSlot", "胡须"),
])

# 装备类导出的列（英文键 -> 中文表头）
EQUIP_COLS = OrderedDict([
    ("id", "ID"), ("cn", "中文名"), ("enKey", "英文标识"),
    ("category", "分类"), ("subtype", "子类"),
    ("damage", "伤害"), ("knockBack", "击退"), ("crit", "暴击%"),
    ("defense", "防御"), ("useTime", "使用时间"), ("useAnimation", "使用动画"),
    ("rare", "稀有度值"), ("rareCN", "稀有度"), ("value", "售价(铜)"),
    ("shoot", "弹幕ID"), ("shootSpeed", "弹速"), ("ammo", "弹药ID"),
    ("useAmmo", "消耗弹药ID"), ("mana", "魔力消耗"),
    ("healLife", "治疗生命"), ("healMana", "治疗魔力"),
    ("buffType", "增益ID"), ("buffTime", "增益时长"),
    ("maxStack", "最大堆叠"),
    ("melee", "近战"), ("ranged", "远程"), ("magic", "魔法"),
    ("summon", "召唤"), ("sentry", "哨兵"),
    ("pick", "镐力"), ("axe", "斧力"), ("hammer", "锤力"), ("fishingPole", "钓力"),
    ("mountType", "坐骑ID"), ("accessory", "饰品"), ("vanity", "时装"),
    ("social", "社交"), ("dye", "染料"),
    ("paint", "涂料"), ("autoReuse", "自动挥舞"), ("channel", "蓄力"),
    ("material", "材料"), ("consumable", "可消耗"),
    ("createTile", "放置物块"), ("createWall", "放置墙"), ("placeStyle", "放置样式"),
    ("shopCustomPrice", "商店价"), ("tooltipContext", "说明类别"),
    ("BestiaryNotes", "图鉴备注"),
])

# 全物品导出的列（比装备表少一些槽位细节）
ALL_COLS = OrderedDict([
    ("id", "ID"), ("cn", "中文名"), ("enKey", "英文标识"), ("en", "英文别名"),
    ("category", "分类"), ("subtype", "子类"),
    ("damage", "伤害"), ("defense", "防御"), ("rare", "稀有度值"), ("rareCN", "稀有度"),
    ("value", "售价(铜)"), ("maxStack", "最大堆叠"),
    ("accessory", "饰品"), ("vanity", "时装"), ("material", "材料"),
    ("consumable", "可消耗"), ("potion", "药水"), ("questItem", "任务物品"),
    ("ammo", "弹药ID"), ("useAmmo", "消耗弹药ID"), ("shoot", "弹幕ID"),
    ("createTile", "放置物块"), ("createWall", "放置墙"),
    ("buffType", "增益ID"), ("mountType", "坐骑ID"), ("dye", "染料"),
    ("headSlot", "头部槽"), ("bodySlot", "身体槽"), ("legSlot", "腿部槽"),
    ("wingSlot", "翅膀槽"), ("shieldSlot", "盾牌槽"), ("neckSlot", "项链槽"),
    ("shopCustomPrice", "商店价"),
])

# 明显不是物品的 ItemID 常量（国服额外常量与物品 ID 撞号）
EN_BLACKLIST = {"XDExtraMusicCount"}


def load_raw(path):
    items, meta = [], None
    with open(path, encoding="utf-8") as f:
        for lineno, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except Exception as exc:
                print(f"  ! 第 {lineno} 行解析失败：{exc}", file=sys.stderr)
                continue
            if "_meta" in obj:
                meta = obj["_meta"]
                continue
            items.append(obj)
    return items, meta


def apply_custom(items, custom_path):
    """custom_items.json 支持三种操作：
       {"_op":"patch",  "id":4956, "damage":250}        按 ID 修改
       {"_op":"patch",  "cn":"天顶剑", "rare":11}        按中文名修改
       {"_op":"add",    "id":9000, "cn":"我的武器", ...} 新增（id 省略则自动分配）
       {"_op":"delete", "id":1234}                       删除
    """
    if not os.path.exists(custom_path):
        return items, {"patch": 0, "add": 0, "delete": 0}
    with open(custom_path, encoding="utf-8") as f:
        rules = json.load(f)
    if isinstance(rules, dict):
        rules = rules.get("items", [])
    by_id = {o["id"]: o for o in items}
    by_cn = {}
    for o in items:
        by_cn.setdefault(o.get("cn", ""), o)
    stat = Counter()
    for rule in rules:
        op = rule.get("_op", "patch")
        if op == "add":
            new = {k: v for k, v in rule.items() if not k.startswith("_")}
            nid = new.get("id")
            if nid is None:
                nid = max(by_id) + 1
                new["id"] = nid
            new.setdefault("en", [])
            new.setdefault("enKey", (new["en"] or [""])[0])
            new.setdefault("_custom", True)
            by_id[nid] = new
            by_cn.setdefault(new.get("cn", ""), new)
            stat["add"] += 1
            continue
        target = by_id.get(rule.get("id")) if rule.get("id") is not None else by_cn.get(rule.get("cn"))
        if target is None:
            print(f"  ! 自定义规则未匹配：{rule}", file=sys.stderr)
            continue
        if op == "delete":
            target["_deleted"] = True
            stat["delete"] += 1
        else:
            for k, v in rule.items():
                if not k.startswith("_"):
                    target[k] = v
            target["_custom"] = True
            stat["patch"] += 1
    items = [o for o in by_id.values() if not o.get("_deleted")]
    items.sort(key=lambda o: o["id"])
    return items, stat


def classify(o):
    """返回 (分类, 子类)。判定优先级：工具 > 武器 > 护甲 > 饰品 > 坐骑 > 弹药 > 染料 > 时装 > 其他装备 / 非装备"""
    tool = any(o.get(k, 0) and o.get(k, 0) > 0 for k in ("pick", "axe", "hammer", "fishingPole"))
    is_armor = any(o.get(k, -1) >= 0 for k in ("headSlot", "bodySlot", "legSlot"))
    is_acc = bool(o.get("accessory"))
    slot_names = [cn for k, cn in SLOT_CN.items() if o.get(k, -1) >= 0]

    if tool:
        kinds = []
        if o.get("pick", 0) > 0:
            kinds.append("镐")
        if o.get("axe", 0) > 0:
            kinds.append("斧")
        if o.get("hammer", 0) > 0:
            kinds.append("锤")
        if o.get("fishingPole", 0) > 0:
            kinds.append("钓竿")
        return "工具", "+".join(kinds) or "工具"
    if o.get("damage", 0) > 0:
        kinds = [cn for k, cn in (("melee", "近战"), ("ranged", "远程"), ("magic", "魔法"),
                                  ("summon", "召唤"), ("sentry", "哨兵")) if o.get(k)]
        if o.get("consumable") and o.get("ammo", 0) > 0:
            kinds.append("投掷")
        return "武器", "/".join(kinds) if kinds else "其他"
    if is_armor:
        where = [cn for k, cn in (("headSlot", "头盔"), ("bodySlot", "胸甲"), ("legSlot", "护腿")) if o.get(k, -1) >= 0]
        if o.get("vanity") or o.get("social"):
            return "时装", "/".join(where)
        return "护甲", "/".join(where)
    if is_acc:
        return "饰品", "/".join(slot_names) or "其他"
    if o.get("mountType", 0) > 0:
        return "坐骑", "坐骑"
    if o.get("ammo", 0) > 0:
        return "弹药", "弹药"
    if o.get("dye", 0) > 0:
        return "染料", "染料"
    if o.get("paint", 0) > 0:
        return "染料", "涂料"
    if o.get("vanity"):
        return "时装", "时装"
    if o.get("accessory"):
        return "饰品", "其他"
    return "其他物品", ""


EQUIP_CATS = {"工具", "武器", "护甲", "饰品", "坐骑", "弹药", "染料", "时装"}


def enrich(items):
    for o in items:
        en = [n for n in (o.get("en") or []) if n not in EN_BLACKLIST]
        o["en"] = en
        o["enKey"] = en[0] if en else ""
        o["rareCN"] = RARITY.get(o.get("rare"), str(o.get("rare")))
        cat, sub = classify(o)
        o["category"], o["subtype"] = cat, sub
        o["_slotNames"] = [cn for k, cn in SLOT_CN.items() if o.get(k, -1) >= 0]
    return items


def write_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)


def write_csv(path, rows, cols):
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(list(cols.values()))
        for o in rows:
            line = []
            for k in cols:
                v = o.get(k, "")
                if isinstance(v, bool):
                    v = "是" if v else ""
                elif isinstance(v, list):
                    v = "/".join(str(x) for x in v)
                elif v is None:
                    v = ""
                line.append(v)
            w.writerow(line)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default=os.path.join(BASE, "data", "items_full.jsonl"))
    ap.add_argument("--custom", default=os.path.join(BASE, "custom_items.json"))
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)

    print(f"[1/5] 读取原始数据 {args.raw}")
    items, meta = load_raw(args.raw)
    print(f"      物品 {len(items)} 件，字段 {len(items[0]) if items else 0} 个")

    print("[2/5] 应用自定义增删改")
    items, stat = apply_custom(items, args.custom)
    print(f"      修改 {stat['patch']} / 新增 {stat['add']} / 删除 {stat['delete']}")

    print("[3/5] 分类与富化")
    items = enrich(items)
    equip = [o for o in items if o["category"] in EQUIP_CATS]

    print("[4/5] 写出数据集")
    write_json(os.path.join(OUT, "terraria_items_all.json"), {"_meta": meta, "count": len(items), "items": items})
    write_csv(os.path.join(OUT, "terraria_items_all.csv"), items, ALL_COLS)
    write_json(os.path.join(OUT, "terraria_equipment.json"), {"_meta": meta, "count": len(equip), "items": equip})
    write_csv(os.path.join(OUT, "terraria_equipment.csv"), equip, EQUIP_COLS)
    with open(os.path.join(OUT, "terraria_cn_index.csv"), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["中文名", "ID", "英文标识", "分类", "子类"])
        for o in sorted(items, key=lambda x: x["id"]):
            w.writerow([o.get("cn", ""), o["id"], o.get("enKey", ""), o["category"], o["subtype"]])

    print("[5/5] 统计摘要")
    cats = Counter(o["category"] for o in items)
    ecats = Counter(o["category"] for o in equip)
    lines = ["# 泰拉瑞亚物品数据库 摘要", "",
             f"- 游戏：`com.xd.terraria`（国服，Unity + IL2CPP）",
             f"- 来源：`{os.path.basename(args.raw)}`（游戏进程内 `Terraria.Item.SetDefaults` + `Terraria.ID.ItemID` + `Terraria.Lang.GetItemNameValue`）",
             f"- 物品总数：**{len(items)}**，ID 区间 {min(o['id'] for o in items)}–{max(o['id'] for o in items)}",
             f"- 装备类：**{len(equip)}**", "", "## 分类统计（全物品）", ""]
    for k, v in cats.most_common():
        lines.append(f"- {k}: {v}")
    lines += ["", "## 分类统计（装备类）", ""]
    for k, v in ecats.most_common():
        lines.append(f"- {k}: {v}")
    lines += ["", "## 子类 Top 20（装备类）", ""]
    for k, v in Counter(o["subtype"] for o in equip).most_common(20):
        lines.append(f"- {k or '未分类'}: {v}")
    with open(os.path.join(OUT, "SUMMARY.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"      完成 -> {OUT}")
    print("      " + " / ".join(f"{k}:{v}" for k, v in cats.most_common()))


if __name__ == "__main__":
    main()
