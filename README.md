# JsonlViewer

Replays Claude Code session transcripts (the `.jsonl` files under `~/.claude/projects`) turn by turn: prompts, replies, tool calls and results, thinking, compactions, and questions asked with AskUserQuestion drawn the way the terminal showed them.

## Run it

Double-click `JsonlViewer.cmd`, or:

```
node server.js
```

It opens `http://127.0.0.1:4717/` in the default browser and shows the session picker. Needs Node 18 or later; no `npm install`.

Options:

| Option | Default | |
|---|---|---|
| `--port <n>` | `4717` (env `JSONL_VIEWER_PORT`) | the next free port is used if it is taken |
| `--dir <folder>` | `~/.claude/projects` (env `CLAUDE_PROJECTS_DIR`) | where the transcripts are listed from |
| `--bookmarks <file>` | `bookmarks.json` beside `server.js` | where stars and bookmarks are saved |
| `--no-open` | | start without opening a browser |

The server listens on 127.0.0.1 only and reads nothing outside the projects folder. The only file it writes is the bookmarks file, and only for requests from the viewer's own page. The picked session's address is kept in the URL (`#s=<project>/<file>`), so a refresh or a bookmark reopens it.

`public/index.html` also works on its own, opened straight from disk: the Sessions list is hidden and you open a `.jsonl` with the button or by dropping it on the page.

## Using it

- **Sessions** lists every transcript, newest first, with its first prompt, folder, branch, date, prompt count and size. Filter by text or by project.
- **Open a .jsonl file** uses the browser's own file dialog. **Recent** lists the last 15 transcripts you opened, whether picked, dropped on the page or chosen from Sessions, and reopens any of them with one click. The first time you reopen a picked file in a browser session, the browser asks to allow reading it. Reopening a local file needs Chrome or Edge; other browsers use a plain file input, and Recent then keeps only sessions from the list. The list is kept in the browser.
- The left rail lists the turns. **Significant only** keeps the prompts that set a rule, a brief, a direction or a decision, plus the heavy turns; the star marks your own.
- Bookmark any step with the star on its header, the star button in the controls, or B. **← Bookmark** and **Bookmark →** (or `[` and `]`) jump between bookmarked steps and starred turns. A turn holding bookmarks says so in the rail and counts as significant. Stars and bookmarks are saved per transcript in `bookmarks.json` beside the server, so they survive a new port or cleared browser data. Opened from disk, the page keeps them in the browser only.
- Space plays or pauses; Left and Right step; Up and Down change turn. **End of turn** (or the End key) jumps to the last step of the current turn.
- Prompts, replies, thinking, plans, the summary after a compaction and markdown files written by Write are rendered as markdown. HTML tags in them are shown as text.
- Tool results and thinking are off by default; the checkboxes turn them on. Long text is clipped, and **Show all** opens the whole of it.

## Files

| | |
|---|---|
| `server.js` | the local server: the page, `GET /api/sessions`, `GET /api/session?project=&file=`, `GET`/`PUT /api/bookmarks?key=` |
| `bookmarks.json` | stars and bookmarks, created on the first one |
| `JsonlViewer.cmd` | Windows launcher |
| `public/index.html` | the viewer |
| `public/vendor/` | marked 12.0.2 and DOMPurify 3.1.6 with their licences, so it runs offline |

The page's fonts (IBM Plex) come from Google Fonts; offline it falls back to Segoe UI and Consolas.
