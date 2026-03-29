---
description: セッション開始時の初期化プロセス
---

このリポジトリのセッション開始時には、必ず以下の手順を実行すること：

1.  `git pull origin master` を実行して最新のコードを取得する。
2.  `python3 scripts/fetch_definitions.py` を実行して、Notionから最新の定義を取得する。
3.  `CLAUDE.md` を読み、コミットメッセージのフォーマット要件を確認する。
4.  現在のプロジェクト名を確認し、セッション内で統一する。
