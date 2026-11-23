# Builds docs\index.html (the app's one page) from src\page.html plus the notes and graph sources.
# Run:  powershell -ExecutionPolicy Bypass -File tools\build.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$src = Join-Path $root 'src'
$utf8 = New-Object System.Text.UTF8Encoding $false
function Frag($name) { ([System.IO.File]::ReadAllText((Join-Path $src $name), [System.Text.Encoding]::UTF8) -replace "`r`n", "`n") }
function Splice([string]$text, [string]$startMark, [string]$endMark, [string]$frag) {
  $e = $text.IndexOf($endMark); if ($e -lt 0) { throw "end marker not found: $endMark" }
  $s = $text.IndexOf($startMark); if ($s -lt 0 -or $s -gt $e) { $s = $e }
  $s = $text.LastIndexOf("`n", $s) + 1; $e = $text.LastIndexOf("`n", $e) + 1
  return $text.Substring(0, $s) + $frag + $text.Substring($e)
}
function Swap([string]$text, [string]$old, [string]$new) { if (-not $text.Contains($old)) { throw "not found: $old" }; return $text.Replace($old, $new) }

$t = Frag 'page.html'
$t = Splice $t '/* ---------- notes: editing ---------- */' '/* ---------- NPCs ---------- */' (Frag 'notes.css')
$t = Splice $t '<!-- NOTES -->' '<!-- NPCS -->' (Frag 'notes.html')
$js = Frag 'notes.js'
$js = Swap $js '// ---------- data ----------' ((Frag 'graph.js') + '// ---------- data ----------')
$t = Splice $t '// ================= NOTES =================' '// ================= NPC ROSTER =================' $js

# App frame: name, install metadata, early theme, settings button, and the shell scripts.
$head = @'
<title>Vael Notes</title>
<meta name="description" content="Design notes, characters and the island map for Vael Awakening.">
<meta name="theme-color" content="#FAFAF5">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Vael Notes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<script>try{var p=JSON.parse(localStorage.getItem('vael.prefs')||'{}');if(p.theme&&p.theme!=='system')document.documentElement.setAttribute('data-theme',p.theme);if(p.text)document.documentElement.setAttribute('data-text',p.text)}catch(e){}</script>
'@ -replace "`r`n", "`n"
$t = Swap $t '<title>Vael Awakening</title>' $head.TrimEnd()
$t = Swap $t "</style>`n</head>" "</style>`n<link rel=`"stylesheet`" href=`"shell.css`">`n</head>"
$gear = '<button class="iconbtn" id="settingsBtn" type="button" aria-label="Settings"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg></button>'
$t = Swap $t '<span class="where" id="where">Design notes</span>' ('<span class="where" id="where">Design notes</span>' + "`n    " + $gear)
$scripts = "<script src=`"config.js`"></script>`n<script src=`"https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js`"></script>`n<script src=`"shell.js`"></script>`n"
$t = Swap $t '<!-- Island plan (classic scripts, shared global scope): loaded from the database by shell.js after sign-in -->' ($scripts + '<!-- Island plan (classic scripts, shared global scope): loaded from the database by shell.js after sign-in -->')

# Wording that named the old Claude page.
$t = Swap $t 'Ask Judah for Editor access.' 'Ask the owner to make you a writer.'
$t = Swap $t 'Ask Judah to share it with you as an Editor.' 'Ask the owner to make you a writer.'
$t = $t.Replace('Open this page on claude.ai while signed in to load the notes.', 'Sign in to load the notes.').Replace('Open this page on claude.ai while signed in to load and edit the roster.', 'Sign in to load the roster.')
$t = $t.Replace('Changes save for everyone who can open this page.', 'Changes save for everyone on the team.')

[System.IO.File]::WriteAllText((Join-Path $root 'docs\index.html'), $t, $utf8)
"built docs\index.html ($($t.Length) chars)"
