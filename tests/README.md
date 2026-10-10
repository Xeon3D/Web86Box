# Tests

Browser tests for Web86Box, driven by [Playwright](https://playwright.dev/).
Serve a build first (`python3 tools/serve.py --dir dist`), then:

| Test | What it checks |
| --- | --- |
| `node tests/boot.mjs <url> <outdir>` | Creates an IBM XT VM whose floppy holds a hand-assembled boot sector, boots it, types into it (`boot.png`). |
| `node tests/apply.mjs <url> <outdir>` | Changes a setting from the running emulator's Settings dialog; the config must reload and the machine hard-reset. |
| `node tests/ui.mjs <url> <outdir>` | Walks through the VM manager and Settings dialog, starts the VM, screenshots each step. |
| `node tests/perf.mjs <url> <outdir> <cfg> [s]` | Runs a VM from an `86box.cfg` and prints the emulation speed every second. |

With a globally installed Playwright, set `PW_MODULE=$(npm root -g)/playwright/index.mjs`.
