// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: brown; icon-glyph: calendar-alt;

/*
 * Quartz Today — a home-screen widget for Scriptable.
 *
 * Today's daily note and the week around it, read from a Quartz server:
 * the date, the first lines of `journal/YYYY-MM-DD.md`, and a dot for each
 * day this week that has a note. Small, medium and large, light and dark.
 *
 * It is for glancing. iOS will not let a widget open a home-screen web app,
 * so a tap opens nothing: Quartz is opened the usual way.
 *
 * Setup: run this script once inside Scriptable. It asks for the server,
 * your user and password, logs in the way the desktop app does, and keeps
 * only the session token — never the password — in Scriptable's keychain.
 * Run it again for the menu: preview a size, switch vault, sign in again.
 */

const KEY = 'quartz.widget'
const DEFAULT_SERVER = 'https://notes.sigint.page'
const FOLDER = 'journal'
const REFRESH_MINUTES = 15

const THEME = {
  bg: ['#faf9f7', '#232220'],
  text: ['#1f1d1a', '#e8e4dd'],
  faint: ['#6f6a61', '#8f897e'],
  future: ['#9a948a', '#6f6a61'],
  accent: ['#a2542a', '#d99a6c'],
  onAccent: ['#ffffff', '#1c1b19'],
  rule: ['#e2ded6', '#322f2b'],
  hollow: ['#c9c3b8', '#45413a'],
}

// ---------------------------------------------------------------- pure parts

/** The local day as `YYYY-MM-DD`: a note for "today" written at 23:00 is today's. */
function isoDay(day) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
}

/** The Monday-to-Sunday week a day falls in. */
function weekOf(day) {
  const monday = new Date(day.getFullYear(), day.getMonth(), day.getDate() - ((day.getDay() + 6) % 7))
  return Array.from({ length: 7 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i))
}

function pathFor(day) {
  return `${FOLDER}/${isoDay(day)}.md`
}

/**
 * What a note says, as plain lines: without the frontmatter and first heading
 * the template writes (they only repeat the date), without code, and with the
 * markdown markers taken off what is left.
 */
function plainLines(text) {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').replace(/^\s*#\s[^\n]*\n?/, '')
  const lines = []
  let fenced = false
  for (const raw of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(raw)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    const line = raw
      .replace(/^\s*#{1,6}\s+/, '')
      .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, '')
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
      .replace(/^\s*>\s?/, '')
      .replace(/!\[\[[^\]]*\]\]/g, '')
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/(\*\*|__|\*|_|`)/g, '')
      .trim()
    if (line) lines.push(line)
  }
  return lines
}

/** A note's opening text, as one paragraph: what the widget shows of today. */
function preview(text) {
  return plainLines(text).join(' ')
}

/** "2 h ago", for content shown while the server cannot be reached. */
function age(at, now) {
  const minutes = Math.max(0, Math.round((now - at) / 60000))
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.round(hours / 24)} d ago`
}

// ------------------------------------------------------------------- server

function load() {
  if (!Keychain.contains(KEY)) return undefined
  try {
    return JSON.parse(Keychain.get(KEY))
  } catch {
    return undefined
  }
}

function save(settings) {
  Keychain.set(KEY, JSON.stringify(settings))
}

class SignedOut extends Error {}

async function call(settings, path) {
  const request = new Request(`${settings.server}${path}`)
  request.headers = { Authorization: `Bearer ${settings.token}` }
  request.timeoutInterval = 15
  const body = await request.loadString()
  const status = request.response.statusCode
  if (status === 401) throw new SignedOut()
  if (status !== 200) throw new Error(`${path} answered ${status}`)
  return body
}

/**
 * What the widget draws, fetched fresh: the week's days and their notes.
 * Small and medium only show today's text, so only the large size reads
 * every written day — at most seven notes, and only when it is on screen.
 */
async function fetchWeek(settings, now, family) {
  const vault = encodeURIComponent(settings.vault)
  const snapshot = JSON.parse(await call(settings, `/api/v/${vault}/snapshot`))
  const present = new Set(snapshot.files.map((file) => file.path))
  const today = isoDay(now)
  const needsAll = family === 'large'

  const days = []
  for (const day of weekOf(now)) {
    const path = pathFor(day)
    const stamp = isoDay(day)
    let text
    if (present.has(path) && (stamp === today || needsAll)) {
      try {
        text = await call(settings, `/api/v/${vault}/file?path=${encodeURIComponent(path)}`)
      } catch (err) {
        if (err instanceof SignedOut) throw err
      }
    }
    days.push({ stamp, written: present.has(path), lines: text === undefined ? [] : plainLines(text).slice(0, 12) })
  }
  return { at: now.getTime(), today, days }
}

const cache = {
  file() {
    const fm = FileManager.local()
    return fm.joinPath(fm.documentsDirectory(), 'quartz-today.json')
  },
  read() {
    const fm = FileManager.local()
    const file = this.file()
    if (!fm.fileExists(file)) return undefined
    try {
      return JSON.parse(fm.readString(file))
    } catch {
      return undefined
    }
  },
  write(data) {
    FileManager.local().writeString(this.file(), JSON.stringify(data))
  },
}

// ------------------------------------------------------------------- setup

async function signIn(previous) {
  const form = new Alert()
  form.title = 'Sign in to Quartz'
  form.message = 'Only a session token is kept, in Scriptable’s keychain.'
  form.addTextField('Server', previous?.server ?? DEFAULT_SERVER)
  form.addTextField('User', previous?.user ?? '')
  form.addSecureTextField('Password', '')
  form.addAction('Sign in')
  form.addCancelAction('Cancel')
  if ((await form.presentAlert()) === -1) return undefined

  const server = form.textFieldValue(0).trim().replace(/\/+$/, '')
  const user = form.textFieldValue(1).trim()
  const request = new Request(`${server}/auth/login`)
  request.method = 'POST'
  request.headers = { 'Content-Type': 'application/json' }
  request.body = JSON.stringify({ user, password: form.textFieldValue(2), device: 'iphone-widget', client: 'desktop' })
  let answer
  try {
    answer = await request.loadJSON()
  } catch (err) {
    await tell('Could not reach the server', String(err))
    return undefined
  }
  if (request.response.statusCode !== 200 || !answer.token) {
    await tell('Not signed in', answer?.message ?? `The server answered ${request.response.statusCode}.`)
    return undefined
  }

  const vault = await pickVault(answer.vaults ?? [], previous?.vault)
  if (!vault) return undefined
  const settings = { server, user, token: answer.token, vault: vault.id, vaultName: vault.name }
  save(settings)
  return settings
}

async function pickVault(vaults, current) {
  if (vaults.length === 0) {
    await tell('No vaults', 'This account cannot open any vault yet.')
    return undefined
  }
  if (vaults.length === 1) return vaults[0]
  const menu = new Alert()
  menu.title = 'Which vault?'
  for (const vault of vaults) menu.addAction(vault.id === current ? `${vault.name} ✓` : vault.name)
  menu.addCancelAction('Cancel')
  const chosen = await menu.presentSheet()
  return chosen === -1 ? undefined : vaults[chosen]
}

async function tell(title, message) {
  const alert = new Alert()
  alert.title = title
  alert.message = message
  alert.addAction('OK')
  await alert.presentAlert()
}

/** Run inside Scriptable: sign in the first time, a menu after that. */
async function runInApp() {
  let settings = load()
  if (!settings) {
    settings = await signIn()
    if (!settings) return
  }
  const menu = new Alert()
  menu.title = 'Quartz Today'
  menu.message = `${settings.user} · ${settings.vaultName}`
  const actions = ['Preview medium', 'Preview small', 'Preview large', 'Switch vault', 'Sign in again', 'Sign out']
  for (const action of actions) menu.addAction(action)
  menu.addCancelAction('Done')
  const picked = await menu.presentSheet()
  if (picked === -1) return

  if (picked <= 2) {
    const family = ['medium', 'small', 'large'][picked]
    const widget = await buildWidget(family)
    if (family === 'small') await widget.presentSmall()
    else if (family === 'large') await widget.presentLarge()
    else await widget.presentMedium()
  } else if (picked === 3) {
    const vaults = JSON.parse(await call(settings, '/api/vaults'))
    const vault = await pickVault(vaults, settings.vault)
    if (vault) save({ ...settings, vault: vault.id, vaultName: vault.name })
  } else if (picked === 4) {
    await signIn(settings)
  } else {
    Keychain.remove(KEY)
    await tell('Signed out', 'The widget shows “Set up Quartz” until you sign in again.')
  }
}

// ------------------------------------------------------------------ drawing

function color([light, dark]) {
  return Color.dynamic(new Color(light), new Color(dark))
}

function serif(size) {
  // Iowan Old Style, as the app's headings; Scriptable falls back to the
  // system font if a name is unknown.
  return new Font('IowanOldStyle-Bold', size)
}

function formatted(day, pattern) {
  const format = new DateFormatter()
  format.dateFormat = pattern
  return format.string(day)
}

function text(stack, value, font, tint, lines) {
  const t = stack.addText(value)
  t.font = font
  t.textColor = color(tint)
  if (lines) t.lineLimit = lines
  return t
}

function dot(stack, size, tint, hollow) {
  const d = stack.addStack()
  d.size = new Size(size, size)
  d.cornerRadius = size / 2
  if (hollow) {
    d.borderColor = color(tint)
    d.borderWidth = 1.5
  } else {
    d.backgroundColor = color(tint)
  }
  return d
}

function newWidget() {
  const widget = new ListWidget()
  widget.backgroundColor = color(THEME.bg)
  widget.refreshAfterDate = new Date(Date.now() + REFRESH_MINUTES * 60000)
  return widget
}

/** The two lines at the top: the weekday, the date, and what is shown when. */
function header(widget, now, corner, size) {
  const row = widget.addStack()
  row.layoutHorizontally()
  row.topAlignContent()
  const left = row.addStack()
  left.layoutVertically()
  text(left, formatted(now, 'EEEE').toUpperCase(), Font.boldSystemFont(11), THEME.accent)
  text(left, formatted(now, 'd MMMM'), serif(size), THEME.text, 1)
  row.addSpacer()
  text(row, corner, Font.systemFont(11), THEME.faint, 1)
}

function todayText(widget, today, size, lines) {
  if (today.lines.length) {
    text(widget, today.lines.join(' '), Font.systemFont(size), THEME.text, lines)
  } else {
    text(widget, 'Nothing written yet today.', Font.italicSystemFont(size), THEME.faint, 1)
  }
}

function drawMedium(data, now, corner) {
  const widget = newWidget()
  widget.setPadding(16, 18, 14, 18)
  const today = data.days.find((day) => day.stamp === data.today)
  header(widget, now, corner, 23)
  widget.addSpacer(6)
  todayText(widget, today, 14, 2)
  widget.addSpacer()

  const strip = widget.addStack()
  strip.layoutHorizontally()
  data.days.forEach((day, i) => {
    if (i > 0) strip.addSpacer()
    const column = strip.addStack()
    column.layoutVertically()
    column.centerAlignContent()
    const date = new Date(`${day.stamp}T12:00:00`)
    const letter = column.addStack()
    letter.size = new Size(24, 0)
    letter.centerAlignContent()
    text(letter, formatted(date, 'EEEEE'), Font.systemFont(10), THEME.faint)

    const isToday = day.stamp === data.today
    const future = day.stamp > data.today
    const number = column.addStack()
    number.size = new Size(24, 24)
    number.cornerRadius = 12
    number.centerAlignContent()
    if (isToday && day.written) number.backgroundColor = color(THEME.accent)
    if (isToday && !day.written) {
      number.borderColor = color(THEME.accent)
      number.borderWidth = 1.5
    }
    const tint = isToday ? (day.written ? THEME.onAccent : THEME.accent) : future ? THEME.future : THEME.text
    text(number, String(date.getDate()), isToday ? Font.boldSystemFont(12) : Font.systemFont(12), tint)

    const under = column.addStack()
    under.size = new Size(24, 7)
    under.centerAlignContent()
    if (day.written) dot(under, 5, THEME.accent)
  })
  return widget
}

function drawSmall(data, now) {
  const widget = newWidget()
  widget.setPadding(14, 14, 13, 14)
  const today = data.days.find((day) => day.stamp === data.today)

  const top = widget.addStack()
  top.layoutHorizontally()
  top.bottomAlignContent()
  text(top, formatted(now, 'EEE').toUpperCase(), Font.boldSystemFont(11), THEME.accent)
  top.addSpacer(6)
  text(top, String(now.getDate()), serif(30), THEME.text)
  widget.addSpacer(6)
  todayText(widget, today, 13, 4)
  widget.addSpacer()

  const row = widget.addStack()
  row.layoutHorizontally()
  row.centerAlignContent()
  data.days.forEach((day, i) => {
    if (i > 0) row.addSpacer()
    if (day.stamp === data.today) dot(row, 10, THEME.accent, !day.written)
    else if (day.written) dot(row, 8, THEME.accent)
    else dot(row, 8, THEME.hollow, true)
  })
  return widget
}

function drawLarge(data, now, corner) {
  const widget = newWidget()
  widget.setPadding(18, 20, 16, 20)
  const today = data.days.find((day) => day.stamp === data.today)
  header(widget, now, corner, 25)
  widget.addSpacer(8)
  todayText(widget, today, 14.5, 6)
  widget.addSpacer()

  const rule = widget.addStack()
  rule.size = new Size(0, 1)
  rule.backgroundColor = color(THEME.rule)
  widget.addSpacer(9)

  for (const day of data.days) {
    const row = widget.addStack()
    row.layoutHorizontally()
    row.centerAlignContent()
    const date = new Date(`${day.stamp}T12:00:00`)
    const isToday = day.stamp === data.today
    const label = row.addStack()
    label.size = new Size(48, 0)
    text(label, formatted(date, 'EEE d'), isToday ? Font.boldSystemFont(12.5) : Font.systemFont(12.5), isToday ? THEME.accent : THEME.faint, 1)
    label.addSpacer()
    const mark = row.addStack()
    mark.size = new Size(14, 6)
    if (day.written) dot(mark, 6, THEME.accent)
    if (day.written) text(row, day.lines[0] ?? '', Font.systemFont(12.5), THEME.text, 1)
    else text(row, day.stamp < data.today ? 'No note' : '', Font.systemFont(12.5), THEME.future, 1)
    row.addSpacer()
    widget.addSpacer(4)
  }
  return widget
}

/** The two ways there is nothing to show: never set up, or signed out. */
function drawNotice(title, message) {
  const widget = newWidget()
  widget.setPadding(16, 18, 16, 18)
  widget.addSpacer()
  const lock = widget.addImage(SFSymbol.named('lock').image)
  lock.imageSize = new Size(24, 24)
  lock.tintColor = color(THEME.accent)
  lock.centerAlignImage()
  widget.addSpacer(6)
  const t = text(widget, title, serif(19), THEME.text, 1)
  t.centerAlignText()
  widget.addSpacer(3)
  const m = text(widget, message, Font.systemFont(12.5), THEME.faint, 3)
  m.centerAlignText()
  widget.addSpacer()
  return widget
}

async function buildWidget(family) {
  const settings = load()
  if (!settings) return drawNotice('Set up Quartz', 'Run “Quartz Today” in Scriptable to sign in.')

  const now = new Date()
  let data
  let corner = 'Quartz'
  try {
    data = await fetchWeek(settings, now, family)
    cache.write(data)
  } catch (err) {
    if (err instanceof SignedOut) {
      return drawNotice('Sign in again', 'The Quartz session ran out. Run “Quartz Today” in Scriptable to sign in.')
    }
    // Unreachable: the last thing fetched, with its age — but only if it is
    // still this week's, or the dots would be for days that have gone.
    const cached = cache.read()
    if (!cached || isoDay(weekOf(now)[0]) !== cached.days[0]?.stamp) {
      return drawNotice('Offline', 'Quartz could not be reached, and nothing from this week is saved here yet.')
    }
    data = { ...cached, today: isoDay(now) }
    corner = `Offline · ${age(cached.at, now.getTime())}`
  }

  if (family === 'small') return drawSmall(data, now)
  if (family === 'large') return drawLarge(data, now, corner)
  return drawMedium(data, now, corner)
}

// --------------------------------------------------------------------- main

if (typeof module !== 'undefined' && typeof Script === 'undefined') {
  // Loaded by a test outside Scriptable: hand over the parts that do not draw.
  module.exports = { isoDay, weekOf, pathFor, plainLines, preview, age }
} else {
  // In a function rather than at the top level, so the file also loads in a
  // test runner that has no top-level await.
  ;(async () => {
    if (config.runsInWidget) Script.setWidget(await buildWidget(config.widgetFamily))
    else await runInApp()
    Script.complete()
  })()
}
