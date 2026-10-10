# Web86Box

[86Box](https://github.com/86Box/86Box) — the emulator of x86 PCs from the
IBM PC of 1981 to late-90s Pentium II systems — compiled to WebAssembly and
running entirely in the browser, with a user interface modeled on 86Box's
own Qt interface.

- **Same emulator core.** 86Box itself is a pinned submodule, built with
  Emscripten; only a small CMake patch is applied. Machines, CPUs, video,
  sound, storage and peripherals are 86Box's own code.
- **Qt-style UI.** A VM manager start screen, the main window with 86Box's
  menu bar (Action / View / Media / Tools / Help), toolbar and status bar
  with per-drive media menus, and the full tabbed Settings dialog
  (machine, display, input, sound, network, ports, storage controllers,
  hard disks, floppy and CD-ROM drives, other removable devices, other
  peripherals) with per-device configuration dialogs. It uses 86Box's own
  icons.
- **Local and persistent.** VMs and disk images live in the browser's
  Origin Private File System; nothing is uploaded anywhere. ROMs are
  downloaded individually, only when a machine needs them.

## Using it

Open the site, click **Add**, name the machine and pick its hardware in the
Settings dialog (exactly as in 86Box), then **Start**.

- **Disks and media**: use *Hard disks → New…/Existing…* in Settings, or
  the drive icons in the status bar / the *Media* menu to insert floppy and
  CD-ROM images. Images are copied into the VM's private folder; *Files*
  in the VM manager imports, downloads and deletes them.
- **Mouse**: click the screen to capture it; **Ctrl+End** (or the middle
  button) releases it. Browsers also release it on **Esc**.
- **Keyboard**: keys go to the emulated machine while the screen has focus.
  Browser-reserved shortcuts (Ctrl+W, Ctrl+T…) can only be captured in
  fullscreen (View → Fullscreen) in browsers with the Keyboard Lock API.
- **Ctrl+Alt+Del** and other combinations are in the *Action* menu and the
  toolbar.

### Browser requirements

86Box only builds as a 64-bit program, so this uses **64-bit WebAssembly
(memory64)** together with threads (SharedArrayBuffer):

| Browser | Supported |
| --- | --- |
| Chrome / Edge 133+ | yes |
| Firefox 134+ | yes |
| Safari | not yet (no memory64) |

The page must be cross-origin isolated (COOP/COEP headers). On hosts that
cannot send headers, such as GitHub Pages, the included
`coi-serviceworker.js` adds them after a one-time reload.

### Limitations

- **CPU emulation uses 86Box's interpreter.** The dynamic recompilers
  generate x86 machine code and cannot run in WebAssembly. Pentium-class
  machines still run in real time on a fast host for typical workloads,
  but very fast machines will not reach 100% speed.
- **No networking yet.** Browsers cannot open raw sockets and libslirp is
  not ported; network cards work but are attached to the null driver.
- No host CD-ROM/floppy passthrough, host MIDI devices, audio input,
  printer output, or OpenGL/Vulkan shaders.
- Audio tracks of CD images in compressed formats (FLAC, MP3…) are silent
  (libsndfile is not built for the web).

## How it works

```
 browser main thread                       Web Workers (wasm threads)
┌──────────────────────────┐   commands   ┌───────────────────────────────┐
│ web/js: Qt-style UI,     │ ───────────▶ │ main():  web_main.c           │
│ keyboard/mouse/gamepad   │   events     │   UI command queue, 1s timer  │
│ canvas presentation      │ ◀─────────── │ cpu thread: pc_run() paced    │
│                          │              │   like the Qt frontend        │
│ AudioWorklet mixer ◀─────┼── shared ────┤ 86Box threads (sound, disk…)  │
└──────────────────────────┘   memory     └───────────────────────────────┘
        ▲                                     │ WasmFS
        │ OPFS (VMs, images)                  ├─ /opfs  Origin Private File System
        └─────────────────────────────────────┤─ /roms  fetched lazily over HTTP
                                              └─ /tmp   memory
```

- `platform/` is a new 86Box platform layer (alongside 86Box's `src/qt`
  and `src/unix`): `web_main.c` (startup, emulator thread, commands, input),
  `web_video.c` (triple-buffered RGBA framebuffer in shared memory),
  `web_audio.c` (one ring buffer per 86Box sound source, mixed and
  resampled by `web/js/audio-worklet.js`), `web_fs.c` (WasmFS mounts and
  the ROM manifest), `web_catalog.c` (machines, CPUs and devices with their
  configuration schemas, as JSON for the Settings dialog), `web_ui.c`
  (message boxes, status bar), plus Gamepad-API joysticks and stubs for
  SLiRP and libsndfile.
- The JS side reads the emulator's status block (`web_shared_t`) straight
  out of the shared wasm memory every animation frame; everything else is a
  text command (`web_command`) or an event (`Module.web86box.onEvent`).
- The Settings dialog edits `86box.cfg` using the same sections, keys and
  formats as 86Box's `config.c`, then asks the emulator to reload the file
  and hard-reset, which is what applying settings does in the Qt UI.

## Building

Requirements: the [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html)
(tested with 6.0.12), CMake ≥ 3.21, Ninja and Python 3.

```sh
git clone --recursive https://github.com/Xeon3D/Web86Box.git
cd Web86Box
source /path/to/emsdk/emsdk_env.sh

# The ROM set is not part of this repository.
git clone --depth 1 https://github.com/86Box/roms.git ../roms

ROMS_DIR=../roms ./build.sh          # release build into dist/
python3 tools/serve.py --dir dist    # http://127.0.0.1:8086/
```

`BUILD_TYPE=Debug ./build.sh` builds with debug info and assertions.
`tools/serve.py` sends the COOP/COEP headers and supports HTTP range
requests; any static server that does the same works.

The site is self-contained static files (`dist/`): `index.html`, the
`86Box.mjs`/`86Box.wasm` pair, `js/`, `css/`, `icons/` and `roms/` with its
`manifest.txt`. The GitHub Actions workflow in `.github/workflows` builds
it, runs the browser tests and deploys it to GitHub Pages on pushes to
`main`.

### Updating 86Box

```sh
cd 86Box && git checkout <new commit> && cd ..
tools/apply-patches.sh   # re-apply patches/*.patch; fix up if needed
./build.sh
```

## Tests

See [tests/README.md](tests/README.md): Playwright scripts that boot a
hand-assembled boot sector from a floppy and type into it, apply settings
to a running machine, walk through the UI, and measure emulation speed.

## License

86Box is licensed under the GNU General Public License, version 2 or later,
and so is this port (see `86Box/COPYING`). The ROM images are not part of
this repository; they are fetched from the
[86Box ROM set](https://github.com/86Box/roms) when the site is built.
