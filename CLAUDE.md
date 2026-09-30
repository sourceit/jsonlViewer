# CLAUDE.md

Guidance for Claude Code when working in this folder.

## What this is

JsonlViewer replays Claude Code session transcripts (the `.jsonl` files under `~/.claude/projects`) turn by turn in the browser. It is two files that matter:

- `server.js` -- a small Node HTTP server (no dependencies, Node 18+). It serves `public/`, lists the transcripts (`GET /api/sessions`), streams one (`GET /api/session?project=&file=`), and keeps stars and bookmarks per transcript file name (`GET`/`PUT /api/bookmarks?key=`). The page also keeps them in `localStorage`; served, the server's file wins, and one it has never seen takes the browser's.
- `public/index.html` -- the whole viewer: markup, CSS and one inline script. Nothing is built or bundled. The Recent list lives in IndexedDB (`jsonlviewer` / `recent`), not `localStorage`, because it stores `FileSystemFileHandle`s from `showOpenFilePicker` and from dropped files. Where those APIs are missing, the page falls back to the plain file input and records only server sessions.

`JsonlViewer.cmd` is the Windows launcher; `README.md` is the user-facing guide. `public/vendor/` holds marked 12.0.2 and DOMPurify 3.1.6 so the page runs offline.

## Rules

- **Keep it dependency-free.** No `npm install`, no bundler, no framework. `package.json` exists only for `npm start`. A new library goes into `public/vendor/` as a pinned minified file with its licence beside it.
- **The server stays local and confined.** Listen on `127.0.0.1` only. Serve nothing outside `public/`, read nothing outside the projects folder, and keep `sessionPath()` rejecting anything that is not a single path segment ending in `.jsonl`. The one write is `PUT /api/bookmarks`, to the single bookmarks file (`bookmarks.json` beside `server.js`, or `--bookmarks`); keep its checks (`fromThisPage()`: loopback Host, same Origin, JSON body; `bookmarkKey()`, `idList()`, size limit) and add no other write endpoint.
- **The page must still work opened straight from disk.** With no server, the Sessions button stays hidden and loading is by file button or drag and drop. Anything new that needs the server must degrade the same way.
- **Transcripts can be hundreds of MB.** Read them as streams, line by line. The page parses while it reads, and the server's listing caches each file's summary and reads only the new tail of a file that has grown (a live session's transcript only ever grows). Never `readFileSync` a transcript or hold several copies of the text.
- **Text from a transcript is untrusted.** Escape it with `esc()`. Markdown goes through `marked`, then `DOMPurify`. Never assign transcript text to `innerHTML` unescaped.
- **Both themes.** Colours are tokens on `:root`, redefined under `prefers-color-scheme: dark` (guarded by `:root:not([data-theme="light"])`) and under `:root[data-theme="dark"]`. Style components through the tokens only.

## The transcript format, as the parser relies on it

One JSON object per line. The fields that matter:

- `type: "user"` with `message.content` as a string, or an array of `text` and `tool_result` blocks. `isMeta: true` lines are injected context, not the user. Text starting with `<` (system reminders, command output), `Caveat:` or `[Request interrupted` is not a typed prompt. Text starting with `This session is being continued` is the summary written after a compaction.
- Pasted text arrives wrapped in `<pasted_content id="...">...</pasted_content id="...">`, usually after a blank line. Strip the tags; the content is the prompt.
- `type: "assistant"` with `text`, `thinking` and `tool_use` blocks.
- A prompt typed while Claude is working is `type: "attachment"`, `attachment.type: "queued_command"` with `origin.kind: "human"`.
- `type: "system"` with `subtype: "compact_boundary"` marks a compaction; `subtype: "api_error"` an API error.
- An AskUserQuestion's answers are on the result line's top-level `toolUseResult.answers` (question text to answer text), with any notes in `toolUseResult.annotations`. The tool_result text repeats them as `"question"="answer"`, and the parser falls back to that. A declined question is a tool_result with `is_error: true`.
- Lines repeat across resumed sessions; `uuid` removes the duplicates.

AskUserQuestion, ExitPlanMode and TodoWrite are drawn as the terminal shows them rather than as JSON (`drawTool`, `drawAnswer`). Answers are their own event kind, `answer`, so they stay visible when tool results are hidden.

## Running and checking changes

```
node server.js --no-open --port 4799
```

Then open `http://127.0.0.1:4799/`. After editing `public/index.html`, check the inline script parses:

```
node -e "const s=require('fs').readFileSync('public/index.html','utf8');new Function(s.match(/<script>\n([\s\S]*)<\/script>/)[1]);console.log('ok')"
```

Check the page through the server, not from disk: the Claude desktop Browser pane shows `file:` pages as static snapshots without running scripts, and `playwright-cli` blocks `file:` URLs. The built-in example session (at the end of the script) contains a question, an answer and a long result, so the drawn forms and **Show all** can be checked without a real transcript.

## Traps met so far

- `display: grid` on `.drop` overrode the `hidden` attribute, and the drop overlay sat over the page permanently. An element toggled with `hidden` needs `[hidden] { display: none; }` whenever its class sets `display`.
- The page must declare `<meta charset="utf-8">`. Without it a server that sends no charset turns `·` into `Â·`.
- Patching this file from the shell (`node -e`, heredocs inside template literals) silently eats backslashes: regexes such as `/<\/?pasted_content[^>]*>/` lose their escapes and the script stops parsing. Edit with the Edit tool, or write the patch script to a file first, then run the parse check above.
- A text search in `/api/sessions` for `"type":"user"` is a fast path only; the cwd and branch come from the first lines of any type.
