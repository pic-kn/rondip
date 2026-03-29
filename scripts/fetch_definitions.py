#!/usr/bin/env python3
# v2.0
"""
Notionの定義DBからデータを取得して標準出力するスクリプト
（CLAUDE.mdへの書き戻しは行わない）
"""
import os
import requests

NOTION_API_KEY = os.environ.get("NOTION_API_KEY")
NOTION_DEFINITION_DB_ID = os.environ.get("NOTION_DEFINITION_DB_ID")

if not NOTION_API_KEY or not NOTION_DEFINITION_DB_ID:
    print("NOTION_API_KEY または NOTION_DEFINITION_DB_ID が未設定のためスキップします")
    exit(0)

headers = {
    "Authorization": f"Bearer {NOTION_API_KEY}",
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28"
}

res = requests.post(
    f"https://api.notion.com/v1/databases/{NOTION_DEFINITION_DB_ID}/query",
    headers=headers,
    json={"sorts": [{"property": "定義名", "direction": "ascending"}]}
)

if res.status_code != 200:
    print(f"Notion取得失敗: {res.text}")
    exit(1)

pages = res.json().get("results", [])
definitions = []

for page in pages:
    props = page["properties"]

    def get_text(prop_name):
        prop = props.get(prop_name, {})
        if prop.get("title"):
            return prop["title"][0]["text"]["content"] if prop["title"] else ""
        if prop.get("rich_text"):
            return prop["rich_text"][0]["text"]["content"] if prop["rich_text"] else ""
        if prop.get("select"):
            return prop["select"]["name"] if prop["select"] else ""
        return ""

    name = get_text("定義名")
    category = get_text("カテゴリ")
    scope = get_text("スコープ") or "共通"
    content = get_text("内容")
    example = get_text("事例")

    if name:
        definitions.append({
            "name": name,
            "category": category,
            "scope": scope,
            "content": content,
            "example": example
        })

print(f"\n=== 定義一覧（{len(definitions)}件）===")
for d in definitions:
    print(f"\n【{d['name']}】")
    print(f"  カテゴリ: {d['category']} / スコープ: {d['scope']}")
    print(f"  内容: {d['content']}")
    if d['example']:
        print(f"  事例: {d['example']}")
