# Genesis runtime and Buzz Desktop updates

Genesis's launcher uses an independently pinned Buzz 0.5.23 runtime in
`%LOCALAPPDATA%\OpenClawHome\runtimes\buzz-genesis\0.5.23`, including its own CLI
on PATH. It verifies the runtime manifest before launch. Desktop updates must
not replace these files or redirect the launcher to the desktop sidecar.

This fixes the recurring Windows update lock caused by a persistent Genesis
process holding the desktop installation's `buzz-acp.exe` open. Identity,
personality sources, model policy, relay and working directory are unchanged.
Review and upgrade the pinned runtime separately when needed.

On Alan's Agent57 machine, **Update Buzz safely** runs the OpenClaw project's
`scripts/update-buzz-safely.ps1`. That route verifies the official release and
embedded assets, backs up the desktop, refuses locked files and verifies the
installed package. The native Buzz update button does not use that wrapper.

Run `powershell -NoProfile -File scripts/ops/verify-buzz-runtime.ps1` to check
the runtime hashes, exactly one owner-only harness and established connections.
Add `-RequireDesktopClosed` for the exclusive-write lock check during maintenance.
The desktop itself may hold package files while it is open.

Live acceptance on 2026-09-05: the isolated harness remained connected with the
same process ID and creation time through a full 0.5.23 desktop reinstall;
desktop package hashes, existing credentials and visible profile passed.
