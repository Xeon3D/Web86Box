/*
 * Web86Box - entry point and emulator thread for the web platform.
 *
 * Threads (all are Web Workers sharing the wasm memory):
 *   - "main" (PROXY_TO_PTHREAD): runs main() below. Sets up the filesystem,
 *     waits for the UI to pick a VM, then services UI commands and the
 *     one-second timer while the emulator runs.
 *   - "cpu": runs pc_run() paced to real time, like the Qt frontend.
 *   - helper threads created by 86Box itself (sound, disk, network, ...).
 *
 * The browser main thread only ever calls the small non-blocking entry
 * points exported here (web_command, web_key, web_mouse_*), and reads the
 * shared state (web_shared_t) for video, audio and the status bar.
 */
#include <stdatomic.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <emscripten.h>
#include <emscripten/threading.h>

#include <86box/86box.h>
#include <86box/config.h>
#include <86box/device.h>
#include <86box/keyboard.h>
#include <86box/mouse.h>
#include <86box/plat.h>
#include <86box/thread.h>
#include <86box/timer.h>
#include <86box/ui.h>
#include <86box/video.h>
#include <86box/plat_unused.h>
#include <86box/nvr.h>
#include <86box/sound.h>
#include <86box/fdd.h>
#include <86box/cdrom.h>

#include "web_shared.h"
#include "web_json.h"

/* Globals the rest of 86Box expects the platform to define. */
int           rctrl_is_lalt;
int           update_icons = 1;
int           kbd_req_capture;
int           hide_status_bar;
int           hide_tool_bar;
bool          fast_forward = false;
volatile int  cpu_thread_run = 1;
int           mouse_capture;
int           infocus = 1;

web_shared_t web_shared __attribute__((aligned(16)));

static thread_t        *cpu_thread = NULL;
static atomic_int       reload_pending;
static atomic_int       cpu_thread_running;

/* -------------------------------------------------------------------------
 * Events to the UI
 * ---------------------------------------------------------------------- */

void
web_post_event(const char *type, const char *payload)
{
    char *t = strdup(type ? type : "");
    char *p = strdup(payload ? payload : "");

    MAIN_THREAD_ASYNC_EM_ASM({
        var type    = UTF8ToString($0);
        var payload = UTF8ToString($1);
        _free($0);
        _free($1);
        if (Module.web86box && Module.web86box.onEvent)
            Module.web86box.onEvent(type, payload);
    }, t, p);
}

/* -------------------------------------------------------------------------
 * Command queue (UI -> emulator)
 *
 * The browser main thread must never block, so the queue is a small
 * spinlock-protected ring; the producer only holds it for a few stores.
 * ---------------------------------------------------------------------- */

#define CMD_QUEUE_LEN 256

static char      *cmd_queue[CMD_QUEUE_LEN];
static int        cmd_head;
static int        cmd_tail;
static atomic_flag cmd_lock = ATOMIC_FLAG_INIT;

static void
cmd_lock_acquire(void)
{
    while (atomic_flag_test_and_set_explicit(&cmd_lock, memory_order_acquire))
        ;
}

static void
cmd_lock_release(void)
{
    atomic_flag_clear_explicit(&cmd_lock, memory_order_release);
}

/* Takes ownership of `cmd`, which must come from malloc(). */
EMSCRIPTEN_KEEPALIVE void
web_command(char *cmd)
{
    cmd_lock_acquire();
    int next = (cmd_head + 1) % CMD_QUEUE_LEN;
    if (next == cmd_tail) {
        cmd_lock_release();
        free(cmd);
        return;
    }
    cmd_queue[cmd_head] = cmd;
    cmd_head            = next;
    cmd_lock_release();
}

static char *
cmd_pop(void)
{
    char *ret = NULL;

    cmd_lock_acquire();
    if (cmd_tail != cmd_head) {
        ret      = cmd_queue[cmd_tail];
        cmd_tail = (cmd_tail + 1) % CMD_QUEUE_LEN;
    }
    cmd_lock_release();

    return ret;
}

/* -------------------------------------------------------------------------
 * Input entry points (called directly from the browser main thread, the
 * same way the Qt frontend calls them from its GUI thread).
 * ---------------------------------------------------------------------- */

EMSCRIPTEN_KEEPALIVE void
web_key(int down, int scancode)
{
    if (atomic_load(&cpu_thread_running))
        keyboard_input(down, (uint16_t) scancode);
}

EMSCRIPTEN_KEEPALIVE void
web_mouse_move(int dx, int dy)
{
    if (atomic_load(&cpu_thread_running))
        mouse_scale(dx, dy);
}

EMSCRIPTEN_KEEPALIVE void
web_mouse_abs(double x, double y, int in_range)
{
    if (!atomic_load(&cpu_thread_running))
        return;
    mouse_x_abs               = x;
    mouse_y_abs               = y;
    mouse_tablet_in_proximity = in_range;
}

EMSCRIPTEN_KEEPALIVE void
web_mouse_buttons(int mask)
{
    if (atomic_load(&cpu_thread_running))
        mouse_set_buttons_ex(mask);
}

EMSCRIPTEN_KEEPALIVE void
web_mouse_wheel(int dz)
{
    if (atomic_load(&cpu_thread_running))
        mouse_set_z(dz);
}

EMSCRIPTEN_KEEPALIVE web_shared_t *
web_get_shared(void)
{
    return &web_shared;
}

/* -------------------------------------------------------------------------
 * Emulator (CPU) thread - mirrors main_thread_fn() in qt_main.cpp.
 * ---------------------------------------------------------------------- */

static void
web_reload_config(void)
{
    /* Re-read the configuration the UI has just written, then rebuild the
       machine from it. Runs on the CPU thread so nothing is executing. */
    pc_reset_hard_close();
    config_load();
    video_copy = (video_grayscale || invert_display) ? video_transform_copy : memcpy;
    pc_reset_hard_init();
    config_save();
    web_post_event("config_reloaded", "");
}

static void
cpu_thread_fn(UNUSED(void *param))
{
    const double quantum_ms  = force_10ms ? 10.0 : 1.0;
    const double max_debt_ms = 50.0;
    double       old_ms      = emscripten_get_now();
    double       debt_ms     = 0.0;
    int          frames      = 0;

    plat_set_thread_name(NULL, "cpu_thread");
    is_cpu_thread = 1;
    framecountx   = 0;

    while (!is_quit && cpu_thread_run) {
        const double new_ms = emscripten_get_now();
        debt_ms += (new_ms - old_ms);
        old_ms = new_ms;
        if (debt_ms > max_debt_ms)
            debt_ms = max_debt_ms;

        if (atomic_exchange(&reload_pending, 0))
            web_reload_config();

        if (((debt_ms >= quantum_ms) || fast_forward) && !dopause) {
            pc_run();

            /* Every 2 emulated seconds we save the machine status. */
            if (++frames >= (force_10ms ? 200 : 2000) && nvr_dosave) {
                nvr_save();
                nvr_dosave = 0;
                frames     = 0;
            }

            if (!fast_forward && debt_ms >= quantum_ms)
                debt_ms -= quantum_ms;
            else
                debt_ms = 0;
        } else {
            if (hard_reset_pending) {
                hard_reset_pending = 0;
                pc_reset_hard_close();
                pc_reset_hard_init();
            }

            if (dopause)
                ack_pause();

            plat_delay_ms(1);
        }
    }

    atomic_store(&cpu_thread_running, 0);
    is_quit = 1;
}

void
do_start(void)
{
    is_quit    = 0;
    timer_freq = 1000000; /* plat_timer_read() counts microseconds */

    atomic_store(&cpu_thread_running, 1);
    cpu_thread = thread_create(cpu_thread_fn, NULL);
}

void
do_stop(void)
{
    cpu_thread_run = 0;
    is_quit        = 1;
}

/* -------------------------------------------------------------------------
 * Command handling (runs on the "main" pthread).
 * ---------------------------------------------------------------------- */

/* Splits "verb arg1 arg2 rest..." in place; returns the number of fields.
   The last field receives the remainder of the line (paths with spaces). */
static int
split_args(char *s, char **argv, int max)
{
    int n = 0;

    while (*s && n < max) {
        while (*s == ' ')
            s++;
        if (!*s)
            break;
        argv[n++] = s;
        if (n == max)
            break;
        while (*s && *s != ' ')
            s++;
        if (*s)
            *s++ = '\0';
    }

    return n;
}

static void
send_status_json(void)
{
    jbuf_t b = { 0 };

    jb_raw(&b, "{");
    jb_key(&b, "paused");
    jb_printf(&b, "%d,", dopause);
    jb_key(&b, "title");
    jb_str(&b, ui_window_title(NULL));
    jb_raw(&b, "}");
    web_post_event("status", b.s);
    free(b.s);
}

static void
handle_command(char *line)
{
    char *argv[4] = { 0 };
    int   argc;

    /* Commands that carry a path keep it whole as the last field. */
    if (!strncmp(line, "fdd_mount ", 10) || !strncmp(line, "rdisk_mount ", 12) || !strncmp(line, "mo_mount ", 9))
        argc = split_args(line, argv, 4);
    else if (!strncmp(line, "cdrom_mount ", 12) || !strncmp(line, "cartridge_mount ", 16))
        argc = split_args(line, argv, 3);
    else if (!strncmp(line, "cassette_mount ", 15))
        argc = split_args(line, argv, 3);
    else
        argc = split_args(line, argv, 4);

    if (argc == 0)
        return;

    const char *verb = argv[0];

    if (!strcmp(verb, "pause")) {
        plat_pause(argc > 1 ? atoi(argv[1]) : !dopause);
        send_status_json();
    } else if (!strcmp(verb, "hard_reset")) {
        pc_reset_hard();
    } else if (!strcmp(verb, "cad")) {
        pc_send_cad();
    } else if (!strcmp(verb, "cae")) {
        pc_send_cae();
    } else if (!strcmp(verb, "power_off")) {
        plat_power_off();
    } else if (!strcmp(verb, "reload_config")) {
        atomic_store(&reload_pending, 1);
    } else if (!strcmp(verb, "save_config")) {
        config_save();
    } else if (!strcmp(verb, "mouse_capture") && argc > 1) {
        mouse_capture                = atoi(argv[1]);
        web_shared.mouse_capture = mouse_capture;
    } else if (!strcmp(verb, "fast_forward") && argc > 1) {
        fast_forward = !!atoi(argv[1]);
    } else if (!strcmp(verb, "fdd_mount") && argc > 3) {
        floppy_mount(atoi(argv[1]), argv[3], atoi(argv[2]));
    } else if (!strcmp(verb, "fdd_eject") && argc > 1) {
        floppy_eject(atoi(argv[1]));
    } else if (!strcmp(verb, "cdrom_mount") && argc > 2) {
        cdrom_mount(atoi(argv[1]), argv[2]);
    } else if (!strcmp(verb, "cdrom_eject") && argc > 1) {
        cdrom_eject(atoi(argv[1]));
    } else if (!strcmp(verb, "rdisk_mount") && argc > 3) {
        rdisk_mount(atoi(argv[1]), argv[3], atoi(argv[2]));
    } else if (!strcmp(verb, "rdisk_eject") && argc > 1) {
        rdisk_eject(atoi(argv[1]));
    } else if (!strcmp(verb, "mo_mount") && argc > 3) {
        mo_mount(atoi(argv[1]), argv[3], atoi(argv[2]));
    } else if (!strcmp(verb, "mo_eject") && argc > 1) {
        mo_eject(atoi(argv[1]));
    } else if (!strcmp(verb, "cassette_mount") && argc > 2) {
        cassette_mount(argv[2], atoi(argv[1]));
    } else if (!strcmp(verb, "cassette_eject")) {
        cassette_eject();
    } else if (!strcmp(verb, "cartridge_mount") && argc > 2) {
        cartridge_mount(atoi(argv[1]), argv[2], 0);
    } else if (!strcmp(verb, "cartridge_eject") && argc > 1) {
        cartridge_eject(atoi(argv[1]));
    } else if (!strcmp(verb, "status")) {
        send_status_json();
    } else {
        pclog("web: unknown command '%s'\n", verb);
    }
}

/* -------------------------------------------------------------------------
 * main
 * ---------------------------------------------------------------------- */

static void
set_state(int state)
{
    __atomic_store_n(&web_shared.state, state, __ATOMIC_SEQ_CST);
    char tmp[16];
    snprintf(tmp, sizeof(tmp), "%d", state);
    web_post_event("state", tmp);
}

/* Blocks until the UI sends "start <vm path>". */
static char *
wait_for_start(void)
{
    for (;;) {
        char *cmd = cmd_pop();
        if (cmd) {
            if (!strncmp(cmd, "start ", 6)) {
                char *path = strdup(cmd + 6);
                free(cmd);
                return path;
            }
            free(cmd);
        }
        emscripten_thread_sleep(10);
    }
}

int
main(int argc, char **argv)
{
    const char *rom_url = (argc > 1) ? argv[1] : "roms";

    memset(&web_shared, 0, sizeof(web_shared));
    web_shared.magic            = WEB_SHARED_MAGIC;
    web_shared.version          = WEB_SHARED_VERSION;
    web_shared.audio_gain_milli = 1000;
    set_state(WEB_STATE_BOOT);

    if (!web_fs_init(rom_url)) {
        set_state(WEB_STATE_ERROR);
        web_post_event("error", "Failed to initialize the filesystem or ROM manifest.");
        return 1;
    }

    set_state(WEB_STATE_WAITING);
    char *vm_path = wait_for_start();

    char *pc_argv[] = { "86Box", "-P", vm_path, NULL };
    if (!pc_init(3, pc_argv)) {
        set_state(WEB_STATE_ERROR);
        web_post_event("error", "pc_init failed.");
        return 1;
    }

    if (!pc_init_roms()) {
        ui_msgbox_header(MBX_FATAL, "No ROMs found.",
                         EMU_NAME " could not find any usable ROM images.");
        set_state(WEB_STATE_ERROR);
        return 6;
    }
    pc_init_modules();

    for (uint8_t i = 1; i < GFXCARD_MAX; i++)
        gfxcard[i] = 0;

    char *catalog = web_catalog_json();
    web_post_event("catalog", catalog);
    free(catalog);

    web_video_init();
    pc_reset_hard_init();
    plat_pause(0);
    do_start();
    set_state(WEB_STATE_RUNNING);
    send_status_json();

    double next_onesec = emscripten_get_now() + 1000.0;
    while (!is_quit) {
        char *cmd;
        while ((cmd = cmd_pop()) != NULL) {
            handle_command(cmd);
            free(cmd);
        }

        double now = emscripten_get_now();
        if (now >= next_onesec) {
            next_onesec += 1000.0;
            if (now > next_onesec)
                next_onesec = now + 1000.0;
            pc_onesec();
        }

        emscripten_thread_sleep(4);
    }

    /* Wait for the CPU thread to leave pc_run() before tearing down. */
    while (atomic_load(&cpu_thread_running))
        emscripten_thread_sleep(5);

    pc_close(cpu_thread);
    web_video_close();
    set_state(WEB_STATE_STOPPED);
    return 0;
}
