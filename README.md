# ClassShare

A full-stack classroom sharing app for files, text notes, links, comments, categories, light/dark mode, and admin moderation.

## Run locally

```powershell
cd "C:\Users\Shri Mahaveer Timber\Downloads\neww\classshare"
.\.venv\Scripts\python.exe server.py
```

Open:

```text
http://127.0.0.1:8787
```

## Admin

The default admin passcode is:

```text
classadmin
```

To change it for a session:

```powershell
$env:CLASSSHARE_ADMIN_PASSCODE="your-new-passcode"
.\.venv\Scripts\python.exe server.py
```

## Data

- Database: `data/classshare.sqlite3`
- Uploads: `uploads/`
- Max upload size: 25 MB per file

## GitHub and hosting

Upload the project files to GitHub, but do not upload `.venv/`, `data/`, `uploads/`, or `__pycache__/`.

GitHub Pages cannot run this app because it has a Python backend. For classmates outside your computer to use it, connect the GitHub repo to a Python-friendly host such as Render. Everyone who opens the same hosted URL will share the same database and uploaded files.
