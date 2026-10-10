/*
 * Web86Box - UI hooks (message boxes, title, status bar).
 *
 * Status bar updates arrive at a very high rate from emulation threads, so
 * they only touch the shared status arrays which the UI polls each frame.
 * Message boxes are forwarded to the UI and the calling thread waits for
 * the answer (never the browser main thread, which only runs JS).
 */
#include <stdarg.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <emscripten.h>
#include <emscripten/threading.h>

#include <86box/86box.h>
#include <86box/plat.h>
#include <86box/plat_unused.h>
#include <86box/machine.h>
#include <86box/mouse.h>
#include <86box/ui.h>
#include <86box/version.h>
#include "cpu.h"

#include "web_shared.h"
#include "web_json.h"

int fixed_size_x = 640;
int fixed_size_y = 480;

/* --- Message boxes ----------------------------------------------------- */

static atomic_int msgbox_seq;
static atomic_int msgbox_answer_id = -1;
static atomic_int msgbox_answer;

EMSCRIPTEN_KEEPALIVE void
web_msgbox_reply(int id, int result)
{
    atomic_store(&msgbox_answer, result);
    atomic_store(&msgbox_answer_id, id);
}

int
ui_msgbox_header(int flags, char *header, char *message)
{
    if (!header) {
        if (flags & MBX_FATAL)
            header = "Fatal error";
        else if (flags & MBX_ERROR)
            header = "Error";
        else
            header = EMU_NAME;
    }

    fprintf(stderr, "[msgbox] %s: %s\n", header, message ? message : "");

    if (emscripten_is_main_browser_thread())
        return 0;

    const int id = atomic_fetch_add(&msgbox_seq, 1) + 1;
    jbuf_t    b  = { 0 };

    jb_raw(&b, "{");
    jb_key(&b, "id");
    jb_printf(&b, "%d,", id);
    jb_key(&b, "flags");
    jb_printf(&b, "%d,", flags);
    jb_key(&b, "header");
    jb_str(&b, header);
    jb_raw(&b, ",");
    jb_key(&b, "message");
    jb_str(&b, message ? message : "");
    jb_raw(&b, "}");
    web_post_event("msgbox", b.s);
    free(b.s);

    while (atomic_load(&msgbox_answer_id) != id)
        emscripten_thread_sleep(10);

    return atomic_load(&msgbox_answer);
}

int
ui_msgbox(int flags, char *message)
{
    return ui_msgbox_header(flags, NULL, message);
}

static void
ui_msg_append(char *message, size_t size, size_t *len, const char *format, ...)
{
    va_list args;
    int     written;

    if (*len >= size - 1)
        return;

    va_start(args, format);
    written = vsnprintf(message + *len, size - *len, format, args);
    va_end(args);

    if (written > 0)
        *len = ((size_t) written < size - *len) ? *len + written : size - 1;
}

int
ui_confirm_unsupported_hardware(const ui_unsupported_hardware_t *items, int count, int machine_missing)
{
    char   message[2048];
    size_t len = 0;

    if (count <= 0)
        return 1;

    message[0] = '\0';
    ui_msg_append(message, sizeof(message), &len, "%s\n\n", plat_get_string(STRING_UNSUPPORTED_TEXT));
    const int listed = count <= 6 ? count : 5;
    for (int i = 0; i < listed; i++) {
        ui_msg_append(message, sizeof(message), &len, plat_get_string(items[i].kind), items[i].name);
        ui_msg_append(message, sizeof(message), &len, "\n");
    }
    if (count > listed) {
        ui_msg_append(message, sizeof(message), &len, plat_get_string(STRING_UNSUPPORTED_OTHERS), count - listed);
        ui_msg_append(message, sizeof(message), &len, "\n");
    }

    const int explanation = !machine_missing ? STRING_UNSUPPORTED_REMOVE :
                            count > 1 ? STRING_UNSUPPORTED_REPLACE_REMOVE : STRING_UNSUPPORTED_REPLACE;
    ui_msg_append(message, sizeof(message), &len, "\n%s\n\n%s", plat_get_string(explanation),
                  plat_get_string(STRING_UNSUPPORTED_CONTINUE));

    return ui_msgbox_header(MBX_WARNING | MBX_QUESTION_YN, plat_get_string(STRING_UNSUPPORTED_TITLE), message) == 1;
}

/* --- Title / status ------------------------------------------------------ */

static char window_title[512] = EMU_NAME;

char *
ui_window_title(char *str)
{
    if (!str)
        return window_title;

    if (strcmp(window_title, str)) {
        snprintf(window_title, sizeof(window_title), "%s", str);
        web_post_event("title", window_title);
    }
    return str;
}

void
ui_emu_status(int speed_percent)
{
    web_shared.speed_percent = (uint32_t) speed_percent;
    web_post_event("speed", "");
}

void
ui_hard_reset_completed(void)
{
    char tmp[512];
    jbuf_t b = { 0 };

    jb_raw(&b, "{");
    jb_key(&b, "machine");
    jb_str(&b, machine_get_internal_name());
    jb_raw(&b, ",");
    jb_key(&b, "machine_name");
    jb_str(&b, machine_getname(machine));
    jb_raw(&b, ",");
    snprintf(tmp, sizeof(tmp), "%s/%s", cpu_f->name, cpu_s->name);
    jb_key(&b, "cpu");
    jb_str(&b, tmp);
    jb_raw(&b, ",");
    jb_key(&b, "mouse_release_buttons");
    jb_printf(&b, "%d,", mouse_get_release_buttons());
    jb_key(&b, "mouse_input_mode");
    jb_printf(&b, "%d", mouse_input_mode);
    jb_raw(&b, "}");
    web_post_event("hard_reset", b.s);
    free(b.s);
}

void
ui_update_force_interpreter(void)
{
}

/* --- Status bar ---------------------------------------------------------- */

static inline void
sb_set(uint8_t *arr, int tag, int val)
{
    if (tag < 0 || tag > 255)
        return;
    if (arr[tag] != (uint8_t) !!val) {
        __atomic_store_n(&arr[tag], (uint8_t) !!val, __ATOMIC_RELAXED);
        __atomic_add_fetch(&web_shared.status_seq, 1, __ATOMIC_RELEASE);
    }
}

void
ui_sb_update_icon(int tag, int active)
{
    sb_set(web_shared.sb_active, tag, active);
}

void
ui_sb_update_icon_write(int tag, int active)
{
    sb_set(web_shared.sb_write, tag, active);
}

void
ui_sb_update_icon_state(int tag, int state)
{
    sb_set(web_shared.sb_empty, tag, state);
}

void
ui_sb_update_icon_wp(int tag, int state)
{
    sb_set(web_shared.sb_wp, tag, state);
}

void
ui_sb_update_tip(UNUSED(int arg))
{
    web_post_event("sb_update", "");
}

void
ui_sb_update_panes(void)
{
    web_post_event("sb_update", "");
}

void
ui_sb_update_text(void)
{
}

void
ui_sb_set_text(char *str)
{
    web_post_event("sb_text", str ? str : "");
}

void
ui_sb_bugui(char *str)
{
    web_post_event("sb_text", str ? str : "");
}

void
ui_sb_set_ready(UNUSED(int ready))
{
}

void
ui_sb_mt32lcd(char *str)
{
    web_post_event("mt32lcd", str ? str : "");
}
