# -*- coding: utf-8 -*-
"""MT 管理器 MCP 客户端（本机 127.0.0.1:8787/mcp）。

用法：
  python3 mtmcp.py list                      # 列出所有工具
  python3 mtmcp.py call <工具名> '<JSON参数>'  # 调用工具
  python3 mtmcp.py call mt_apk_list_available_apks '{"prefix":"","limit":20}'
说明：MCP 的 tools/call 返回里 data 是结构化结果；本脚本原样打印 JSON，
     过长时截断到 --max 字符（默认 4000）。
"""
import json, sys, urllib.request, urllib.error

URL = 'http://127.0.0.1:8787/mcp'

def rpc(payload, timeout=120):
    body = json.dumps(payload).encode()
    r = urllib.request.Request(URL, data=body, method='POST')
    r.add_header('Content-Type', 'application/json')
    r.add_header('Accept', 'application/json, text/event-stream')
    try:
        with urllib.request.urlopen(r, timeout=timeout) as x:
            return json.loads(x.read().decode('utf-8', 'replace'))
    except urllib.error.HTTPError as e:
        return {'error': 'HTTP %d: %s' % (e.code, e.read().decode('utf-8', 'replace')[:300])}
    except Exception as e:
        return {'error': str(e)}

def call(tool, args, timeout=120):
    res = rpc({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call',
               'params': {'name': tool, 'arguments': args}}, timeout)
    if 'error' in res: return res
    r = res.get('result', {})
    # MCP 文本内容里通常是 JSON 字符串
    for c in (r.get('content') or []):
        if c.get('type') == 'text':
            try: return json.loads(c['text'])
            except Exception: return c['text']
    return r

def main():
    mx = 4000
    if '--max' in sys.argv:
        i = sys.argv.index('--max'); mx = int(sys.argv[i+1]); del sys.argv[i:i+2]
    if len(sys.argv) < 2 or sys.argv[1] == 'list':
        res = rpc({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list', 'params': {}})
        for t in res.get('result', {}).get('tools', []):
            print('%-34s %s' % (t['name'], (t.get('description') or '').split('。')[0][:70]))
        return
    if sys.argv[1] != 'call' or len(sys.argv) < 3:
        print(__doc__); return
    tool = sys.argv[2]
    args = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}
    out = call(tool, args)
    s = json.dumps(out, ensure_ascii=False, indent=1)
    print(s if len(s) <= mx else s[:mx] + '\n…（截断，共 %d 字符）' % len(s))

if __name__ == '__main__':
    main()
