from __future__ import annotations

import os
import secrets
import shutil
import sqlite3
import time
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field


BASE_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = BASE_DIR / "public"
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = BASE_DIR / "uploads"
DB_PATH = DATA_DIR / "classshare.sqlite3"
MAX_FILE_BYTES = 25 * 1024 * 1024
DEFAULT_CATEGORIES = [
    "Notes",
    "Assignments",
    "Links",
    "Question Papers",
    "Projects",
    "Announcements",
    "Other",
]

DATA_DIR.mkdir(exist_ok=True)
UPLOAD_DIR.mkdir(exist_ok=True)


def now_ms() -> int:
    return int(time.time() * 1000)


def clean_text(value: Optional[str], limit: int) -> str:
    return (value or "").strip()[:limit]


def safe_filename(name: str) -> str:
    cleaned = "".join(ch for ch in name if ch.isalnum() or ch in " ._-").strip()
    return cleaned[:140] or "file"


def clean_link(value: Optional[str]) -> str:
    link = clean_text(value, 1200)
    if not link:
        return ""
    parsed = urlparse(link)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=400, detail="Links must start with http:// or https://")
    return link


def admin_passcode() -> str:
    return os.environ.get("CLASSSHARE_ADMIN_PASSCODE", "classadmin")


def is_admin(passcode: Optional[str]) -> bool:
    if not passcode:
        return False
    return secrets.compare_digest(passcode, admin_passcode())


def connect() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def init_db() -> None:
    with connect() as con:
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS categories (
              name TEXT PRIMARY KEY,
              created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS posts (
              id TEXT PRIMARY KEY,
              type TEXT NOT NULL,
              title TEXT NOT NULL,
              body TEXT NOT NULL DEFAULT '',
              url TEXT NOT NULL DEFAULT '',
              category TEXT NOT NULL,
              author TEXT NOT NULL,
              device_id TEXT NOT NULL,
              pinned INTEGER NOT NULL DEFAULT 0,
              file_name TEXT NOT NULL DEFAULT '',
              file_type TEXT NOT NULL DEFAULT '',
              file_size INTEGER NOT NULL DEFAULT 0,
              stored_name TEXT NOT NULL DEFAULT '',
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS comments (
              id TEXT PRIMARY KEY,
              post_id TEXT NOT NULL,
              body TEXT NOT NULL,
              author TEXT NOT NULL,
              device_id TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL,
              FOREIGN KEY(post_id) REFERENCES posts(id) ON DELETE CASCADE
            );
            """
        )
        stamp = now_ms()
        for index, category in enumerate(DEFAULT_CATEGORIES):
            con.execute(
                "INSERT OR IGNORE INTO categories (name, created_at) VALUES (?, ?)",
                (category, stamp + index),
            )


init_db()
app = FastAPI(title="ClassShare")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class AdminPayload(BaseModel):
    passcode: str = Field(default="", max_length=200)


class EditPostPayload(BaseModel):
    title: str = Field(default="", max_length=120)
    body: str = Field(default="", max_length=12000)
    url: str = Field(default="", max_length=1200)
    category: str = Field(default="Other", max_length=80)
    author: str = Field(default="", max_length=80)
    device_id: str = Field(default="", max_length=120)
    admin_passcode: str = Field(default="", max_length=200)


class CommentPayload(BaseModel):
    body: str = Field(default="", max_length=4000)
    author: str = Field(default="", max_length=80)
    device_id: str = Field(default="", max_length=120)
    admin_passcode: str = Field(default="", max_length=200)


class DeletePayload(BaseModel):
    device_id: str = Field(default="", max_length=120)
    admin_passcode: str = Field(default="", max_length=200)


class PinPayload(BaseModel):
    pinned: bool
    admin_passcode: str = Field(default="", max_length=200)


class CategoryPayload(BaseModel):
    name: str = Field(default="", max_length=80)
    admin_passcode: str = Field(default="", max_length=200)


def row_post(row: sqlite3.Row, comments: list[dict]) -> dict:
    return {
        "id": row["id"],
        "type": row["type"],
        "title": row["title"],
        "body": row["body"],
        "url": row["url"],
        "category": row["category"],
        "author": row["author"],
        "deviceId": row["device_id"],
        "pinned": bool(row["pinned"]),
        "file": {
            "name": row["file_name"],
            "type": row["file_type"],
            "size": row["file_size"],
            "downloadUrl": f"/api/files/{row['id']}",
        }
        if row["stored_name"]
        else None,
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "comments": comments,
    }


def get_post(con: sqlite3.Connection, post_id: str) -> sqlite3.Row:
    post = con.execute("SELECT * FROM posts WHERE id = ?", (post_id,)).fetchone()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    return post


def get_comment(con: sqlite3.Connection, comment_id: str) -> sqlite3.Row:
    comment = con.execute("SELECT * FROM comments WHERE id = ?", (comment_id,)).fetchone()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    return comment


def require_admin(passcode: Optional[str]) -> None:
    if not is_admin(passcode):
        raise HTTPException(status_code=403, detail="Admin passcode is incorrect")


def require_owner_or_admin(row: sqlite3.Row, device_id: str, passcode: str) -> None:
    if is_admin(passcode):
        return
    if row["device_id"] and row["device_id"] == device_id:
        return
    raise HTTPException(status_code=403, detail="You can only change your own item")


def category_exists(con: sqlite3.Connection, name: str) -> bool:
    return bool(con.execute("SELECT 1 FROM categories WHERE name = ?", (name,)).fetchone())


def normalize_category(con: sqlite3.Connection, name: str) -> str:
    category = clean_text(name, 80) or "Other"
    return category if category_exists(con, category) else "Other"


@app.get("/api/state")
def state() -> dict:
    with connect() as con:
        categories = [
            row["name"]
            for row in con.execute("SELECT name FROM categories ORDER BY created_at, name").fetchall()
        ]
        categories.sort(
            key=lambda name: (
                DEFAULT_CATEGORIES.index(name) if name in DEFAULT_CATEGORIES else 1000,
                name.lower(),
            )
        )
        comment_rows = con.execute(
            "SELECT * FROM comments ORDER BY created_at ASC"
        ).fetchall()
        comments_by_post: dict[str, list[dict]] = {}
        for row in comment_rows:
            comments_by_post.setdefault(row["post_id"], []).append(
                {
                    "id": row["id"],
                    "postId": row["post_id"],
                    "body": row["body"],
                    "author": row["author"],
                    "deviceId": row["device_id"],
                    "createdAt": row["created_at"],
                    "updatedAt": row["updated_at"],
                }
            )
        post_rows = con.execute(
            "SELECT * FROM posts ORDER BY pinned DESC, created_at DESC"
        ).fetchall()
        posts = [row_post(row, comments_by_post.get(row["id"], [])) for row in post_rows]
        used_bytes = sum(path.stat().st_size for path in UPLOAD_DIR.glob("*") if path.is_file())
        return {
            "posts": posts,
            "categories": categories,
            "stats": {
                "postCount": len(posts),
                "fileCount": sum(1 for post in posts if post["file"]),
                "storageUsed": used_bytes,
                "maxFileBytes": MAX_FILE_BYTES,
            },
        }


@app.post("/api/admin/check")
def check_admin(payload: AdminPayload) -> dict:
    require_admin(payload.passcode)
    return {"ok": True}


@app.post("/api/posts")
async def create_post(
    type: str = Form(...),
    title: str = Form(""),
    body: str = Form(""),
    url: str = Form(""),
    category: str = Form("Other"),
    author: str = Form(...),
    device_id: str = Form(...),
    file: Optional[UploadFile] = File(default=None),
) -> dict:
    post_type = clean_text(type, 20)
    if post_type not in {"file", "text", "link"}:
        raise HTTPException(status_code=400, detail="Choose file, text, or link")

    title_value = clean_text(title, 120)
    body_value = clean_text(body, 12000)
    url_value = clean_link(url)
    author_value = clean_text(author, 80) or "Classmate"
    device_value = clean_text(device_id, 120)
    if not device_value:
        raise HTTPException(status_code=400, detail="Missing device id")
    if not title_value:
        title_value = "Untitled"
    if post_type == "text" and not body_value:
        raise HTTPException(status_code=400, detail="Text posts need content")
    if post_type == "link" and not url_value:
        raise HTTPException(status_code=400, detail="Link posts need a URL")

    file_name = ""
    file_type = ""
    file_size = 0
    stored_name = ""
    if post_type == "file":
        if not file:
            raise HTTPException(status_code=400, detail="File posts need a file")
        original_name = safe_filename(file.filename or "file")
        stored_name = f"{uuid4().hex}_{original_name}"
        target = UPLOAD_DIR / stored_name
        with target.open("wb") as output:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                file_size += len(chunk)
                if file_size > MAX_FILE_BYTES:
                    output.close()
                    target.unlink(missing_ok=True)
                    raise HTTPException(status_code=413, detail="File is larger than 25 MB")
                output.write(chunk)
        file_name = original_name
        file_type = clean_text(file.content_type or "application/octet-stream", 120)
        if not title_value or title_value == "Untitled":
            title_value = file_name

    with connect() as con:
        category_value = normalize_category(con, category)
        post_id = uuid4().hex
        stamp = now_ms()
        con.execute(
            """
            INSERT INTO posts (
              id, type, title, body, url, category, author, device_id, pinned,
              file_name, file_type, file_size, stored_name, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
            """,
            (
                post_id,
                post_type,
                title_value,
                body_value,
                url_value,
                category_value,
                author_value,
                device_value,
                file_name,
                file_type,
                file_size,
                stored_name,
                stamp,
                stamp,
            ),
        )
        post = get_post(con, post_id)
        return row_post(post, [])


@app.patch("/api/posts/{post_id}")
def edit_post(post_id: str, payload: EditPostPayload) -> dict:
    with connect() as con:
        post = get_post(con, post_id)
        require_owner_or_admin(post, clean_text(payload.device_id, 120), payload.admin_passcode)
        category = normalize_category(con, payload.category)
        title = clean_text(payload.title, 120) or post["title"]
        body = clean_text(payload.body, 12000)
        url = clean_link(payload.url)
        author = clean_text(payload.author, 80) or post["author"]
        if post["type"] == "text" and not body:
            raise HTTPException(status_code=400, detail="Text posts need content")
        if post["type"] == "link" and not url:
            raise HTTPException(status_code=400, detail="Link posts need a URL")
        con.execute(
            """
            UPDATE posts
            SET title = ?, body = ?, url = ?, category = ?, author = ?, updated_at = ?
            WHERE id = ?
            """,
            (title, body, url, category, author, now_ms(), post_id),
        )
        updated = get_post(con, post_id)
        comments = [
            {
                "id": row["id"],
                "postId": row["post_id"],
                "body": row["body"],
                "author": row["author"],
                "deviceId": row["device_id"],
                "createdAt": row["created_at"],
                "updatedAt": row["updated_at"],
            }
            for row in con.execute(
                "SELECT * FROM comments WHERE post_id = ? ORDER BY created_at ASC", (post_id,)
            ).fetchall()
        ]
        return row_post(updated, comments)


@app.delete("/api/posts/{post_id}")
def delete_post(post_id: str, payload: DeletePayload) -> dict:
    with connect() as con:
        post = get_post(con, post_id)
        require_owner_or_admin(post, clean_text(payload.device_id, 120), payload.admin_passcode)
        stored_name = post["stored_name"]
        con.execute("DELETE FROM posts WHERE id = ?", (post_id,))
    if stored_name:
        (UPLOAD_DIR / stored_name).unlink(missing_ok=True)
    return {"ok": True}


@app.post("/api/posts/{post_id}/pin")
def pin_post(post_id: str, payload: PinPayload) -> dict:
    require_admin(payload.admin_passcode)
    with connect() as con:
        get_post(con, post_id)
        con.execute(
            "UPDATE posts SET pinned = ?, updated_at = ? WHERE id = ?",
            (1 if payload.pinned else 0, now_ms(), post_id),
        )
    return {"ok": True}


@app.post("/api/posts/{post_id}/comments")
def create_comment(post_id: str, payload: CommentPayload) -> dict:
    body = clean_text(payload.body, 4000)
    if not body:
        raise HTTPException(status_code=400, detail="Comment cannot be empty")
    author = clean_text(payload.author, 80) or "Classmate"
    device_id = clean_text(payload.device_id, 120)
    if not device_id:
        raise HTTPException(status_code=400, detail="Missing device id")
    with connect() as con:
        get_post(con, post_id)
        comment_id = uuid4().hex
        stamp = now_ms()
        con.execute(
            """
            INSERT INTO comments (id, post_id, body, author, device_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (comment_id, post_id, body, author, device_id, stamp, stamp),
        )
        row = get_comment(con, comment_id)
        return {
            "id": row["id"],
            "postId": row["post_id"],
            "body": row["body"],
            "author": row["author"],
            "deviceId": row["device_id"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }


@app.patch("/api/comments/{comment_id}")
def edit_comment(comment_id: str, payload: CommentPayload) -> dict:
    body = clean_text(payload.body, 4000)
    if not body:
        raise HTTPException(status_code=400, detail="Comment cannot be empty")
    with connect() as con:
        comment = get_comment(con, comment_id)
        require_owner_or_admin(comment, clean_text(payload.device_id, 120), payload.admin_passcode)
        con.execute(
            "UPDATE comments SET body = ?, author = ?, updated_at = ? WHERE id = ?",
            (body, clean_text(payload.author, 80) or comment["author"], now_ms(), comment_id),
        )
        row = get_comment(con, comment_id)
        return {
            "id": row["id"],
            "postId": row["post_id"],
            "body": row["body"],
            "author": row["author"],
            "deviceId": row["device_id"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }


@app.delete("/api/comments/{comment_id}")
def delete_comment(comment_id: str, payload: DeletePayload) -> dict:
    with connect() as con:
        comment = get_comment(con, comment_id)
        require_owner_or_admin(comment, clean_text(payload.device_id, 120), payload.admin_passcode)
        con.execute("DELETE FROM comments WHERE id = ?", (comment_id,))
    return {"ok": True}


@app.post("/api/categories")
def add_category(payload: CategoryPayload) -> dict:
    require_admin(payload.admin_passcode)
    name = clean_text(payload.name, 80)
    if not name:
        raise HTTPException(status_code=400, detail="Category name cannot be empty")
    with connect() as con:
        con.execute(
            "INSERT OR IGNORE INTO categories (name, created_at) VALUES (?, ?)",
            (name, now_ms()),
        )
    return {"ok": True, "name": name}


@app.delete("/api/categories/{name}")
def delete_category(name: str, payload: AdminPayload) -> dict:
    require_admin(payload.passcode)
    if name in DEFAULT_CATEGORIES:
        raise HTTPException(status_code=400, detail="Default categories cannot be deleted")
    with connect() as con:
        con.execute("UPDATE posts SET category = 'Other' WHERE category = ?", (name,))
        con.execute("DELETE FROM categories WHERE name = ?", (name,))
    return {"ok": True}


@app.get("/api/files/{post_id}")
def download_file(post_id: str) -> FileResponse:
    with connect() as con:
        post = get_post(con, post_id)
    if not post["stored_name"]:
        raise HTTPException(status_code=404, detail="No file attached")
    file_path = UPLOAD_DIR / post["stored_name"]
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File is missing on disk")
    return FileResponse(
        path=file_path,
        filename=post["file_name"],
        media_type=post["file_type"] or "application/octet-stream",
    )


@app.post("/api/maintenance/clear-demo")
def clear_demo(payload: AdminPayload) -> dict:
    require_admin(payload.passcode)
    with connect() as con:
        con.execute("DELETE FROM comments")
        con.execute("DELETE FROM posts")
    for path in UPLOAD_DIR.glob("*"):
        if path.is_file():
            path.unlink(missing_ok=True)
        elif path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
    return {"ok": True}


app.mount("/", StaticFiles(directory=PUBLIC_DIR, html=True), name="public")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="127.0.0.1", port=8787, reload=False)
