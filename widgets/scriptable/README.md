# Quartz Today — a Scriptable widget

Today's daily note and the week around it, on the iPhone home screen: the
date, the first lines of `journal/YYYY-MM-DD.md`, and a dot for each day this
week that has a note. Small, medium and large; light and dark follow the phone.

It is for glancing. iOS gives home-screen web apps no way to be opened from
outside, so a tap on the widget opens nothing — Quartz is opened as usual.

## Setup

1. Install [Scriptable](https://scriptable.app) from the App Store.
2. Put `quartz-today.js` in Scriptable as a script named **Quartz Today** —
   paste it into a new script, or drop the file into Scriptable's iCloud
   Drive folder from a Mac.
3. Run it once inside Scriptable. It asks for the server (default
   `https://notes.sigint.page`), your user and password, and which vault if
   you have more than one. It signs in the way the desktop app does and keeps
   only the session token, in Scriptable's keychain — never the password.
4. Long-press the home screen → **+** → Scriptable → pick a size → **Edit
   widget** → Script: **Quartz Today**.

Run the script again inside Scriptable for its menu: preview each size,
switch vault, sign in again, or sign out.

## What it does on each refresh

iOS decides when; the widget asks for one every 15 minutes.

- `GET /api/v/{vault}/snapshot` — which of this week's `journal/` days exist.
- `GET /api/v/{vault}/file?path=…` — today's note; the large size also reads
  the week's other written days, for their first lines.

## States

- **Set up Quartz** — the script has never been run inside Scriptable.
- **Sign in again** — the session ran out (sessions last 90 days). Run the
  script and choose *Sign in again*.
- **Offline · 2 h ago** — the server could not be reached; the last thing
  fetched this week is shown, with its age.
