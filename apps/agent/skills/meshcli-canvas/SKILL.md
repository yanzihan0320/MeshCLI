---
name: meshcli-canvas
description: Operate the MeshCLI conversation canvas; 画布 节点 分支 合并 创建 更新 删除与整理。
---

# MeshCLI Canvas

Use exact node IDs from the current `CanvasSnapshot`. Search for a close topic match before creating a node; append to an existing node when that preserves the user's intent.

- Use branches for genuinely parallel directions.
- Use merge nodes only when at least two existing source IDs are known.
- Keep titles concise and put evidence in assistant messages.
- Reads, searches, focus, ordinary creation, connection, append and updates are safe to request directly.
- Deletion is destructive and must wait for explicit confirmation.
- After an action resumes, report the real command result. Never claim success after `stale`, `rejected`, or `failed`.
