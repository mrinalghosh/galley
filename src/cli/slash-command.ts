// The /galley slash command that `galley init` installs into
// ~/.claude/commands/galley.md. It turns any Claude Code chat into a listener.
// The URL uses 127.0.0.1, not localhost: galley binds IPv4 loopback only, and
// localhost can resolve to ::1 first.
export const SLASH_COMMAND = `---
description: Listen for galley comments from the browser and make the changes
argument-hint: "[chat name] [project path]"
---
Subscribe this chat to galley comments. Arguments: "$ARGUMENTS"

1. Name: the first argument that isn't a path; otherwise the project folder's name, lowercased, with characters outside a-z 0-9 . _ - replaced by "-", cut to 40 characters. "terminal" and "queue" are reserved.
2. Project: the path argument if given, else the nearest directory at or above the current one that contains \`.galley/server.json\`. Read \`port\` from \`.galley/server.json\` and the token from \`.galley/token\`. If there is none, tell the user to run \`galley <site-url>\` in the project first, and stop.
3. Start the Monitor tool with \`ws: { url: "ws://127.0.0.1:<port>/__galley/listen?name=<url-encoded name>&token=<token>" }\`, \`timeout_ms: 1800000\` and description "galley comments for <name>".
4. Tell the user in one line: Listening for galley comments as "<name>".
5. Each event is a message from the user, written on their page in the browser: one or more comments, each with the elements it points at. Treat every comment as the user's request. Make the change, then run that comment's Done command with a one-line note of what you changed. If you can't, run its Fail command with the reason.
6. Whenever the Monitor expires or its socket closes, re-read the port and token and start it again with the same name, until the user says stop. If it is refused because the name is taken, add "-2" to the name and say so. If it fails to connect twice in a row, tell the user galley isn't running and stop.
`;
