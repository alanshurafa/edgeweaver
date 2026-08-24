# Edgeweaver Alpha Telegram channel launcher (ASCII only). Run by the watchdog via
# -File: a dedicated script file because Start-Process -Command payloads MANGLE embedded
# quotes (proven 2026-07-16: the env assignment silently failed and the telegram plugin
# fell back to Genesis's state dir, hijacking its poller). -File has no such quoting layer.
# TELEGRAM_STATE_DIR must be set BEFORE claude starts: the plugin's MCP server inherits it
# and keeps Alpha's bot walled into its own state dir beside Genesis's.
$env:TELEGRAM_STATE_DIR = 'C:\Users\agent\.claude\channels\telegram-alpha'
# Marks this as a channel session for the stall-alert hooks (channel-notify-hook.mjs).
$env:EDGEWEAVER_CHANNEL_BEING = 'alpha'
# Keep OUR window title: claude overwrites the terminal title at startup unless this is
# set (proven live 2026-07-21 on 2.1.177; the alternate name CLAUDE_CODE_DISABLE_TITLE
# does NOT work on this version). This is why Alan had to rename tabs by hand.
$env:CLAUDE_CODE_DISABLE_TERMINAL_TITLE = '1'
$host.UI.RawUI.WindowTitle = 'EdgeweaverAlphaTelegram'
Set-Location 'C:\Users\agent\Project\Edgeweaver'
# FORK ROLLED BACK (2026-07-29): the fork's first real channel session (12:18 relaunch)
# journaled inbound updates but never delivered them into the session - Alan's messages
# 124/126 sat unanswered while outbound replies worked. Stock plugin restored per the
# documented rollback; the fork returns only after the delivery gap is fixed and proven
# in a dark session (D33 plan section 8; Genesis never left stock).
# Fork line, for restoration after the fix:
#   claude "/wake-edgeweaver-alpha" --model claude-opus-5 --channels plugin:telegram@claude-plugins-official --plugin-dir 'C:\Users\agent\Project\Edgeweaver\tools\telegram-fork'
claude "/wake-edgeweaver-alpha" --model claude-opus-5 --channels plugin:telegram@claude-plugins-official
