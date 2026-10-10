/*
 * Web86Box - video output.
 *
 * 86Box renders each monitor into buffer32 (0x00RRGGBB per pixel) and calls
 * the platform blit callback with the dirty rectangle. We convert that
 * rectangle into RGBA bytes inside one of three shared framebuffers and
 * publish it by atomically swapping it into web_shared.fb_ready. The UI
 * swaps it back out on its next animation frame and draws it on a canvas.
 */
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <emscripten.h>

#include <86box/86box.h>
#include <86box/plat.h>
#include <86box/plat_unused.h>
#include <86box/video.h>
#include <86box/ui.h>

#include "web_shared.h"

static uint8_t *framebuffers[WEB_FB_COUNT];
static uint32_t back_index;
static int      video_ready;

static void
web_blit(int x, int y, int w, int h, int monitor_index)
{
    if (monitor_index != 0 || !video_ready || (w <= 0) || (h <= 0)
        || (w > WEB_FB_MAX_W) || (h > WEB_FB_MAX_H) || (buffer32 == NULL)) {
        video_blit_complete_monitor(monitor_index);
        return;
    }

    uint32_t *dst = (uint32_t *) framebuffers[back_index];

    for (int row = 0; row < h; row++) {
        const uint32_t *src = &buffer32->line[y + row][x];
        uint32_t       *out = &dst[row * w];
        for (int col = 0; col < w; col++) {
            const uint32_t p = src[col];
            /* 0x00RRGGBB -> bytes R,G,B,255 (little endian 0xFFBBGGRR). */
            out[col] = 0xff000000u | ((p & 0xff) << 16) | (p & 0xff00) | ((p >> 16) & 0xff);
        }
    }

    web_shared.fb_w[back_index] = (uint32_t) w;
    web_shared.fb_h[back_index] = (uint32_t) h;

    uint32_t prev = __atomic_exchange_n(&web_shared.fb_ready, back_index | WEB_FB_NEW, __ATOMIC_ACQ_REL);
    back_index    = prev & 0xff;
    __atomic_add_fetch(&web_shared.frame_count, 1, __ATOMIC_RELEASE);

    video_blit_complete_monitor(monitor_index);
}

void
web_video_init(void)
{
    for (int i = 0; i < WEB_FB_COUNT; i++) {
        if (!framebuffers[i])
            framebuffers[i] = calloc((size_t) WEB_FB_MAX_W * WEB_FB_MAX_H, 4);
        web_shared.fb_ptr[i] = (uint32_t) (uintptr_t) framebuffers[i];
    }

    /* Buffer 0 starts out "front" (owned by the UI), 1 is the one being
       published, 2 is our back buffer. */
    web_shared.fb_ready = 1;
    back_index          = 2;
    video_ready         = 1;

    video_setblit(web_blit);
}

void
web_video_close(void)
{
    video_ready = 0;
    video_setblit(NULL);
}

void
startblit(void)
{
}

void
endblit(void)
{
}

/* --- Window management hooks ----------------------------------------- */

static void
post_resize(int w, int h)
{
    char tmp[64];
    snprintf(tmp, sizeof(tmp), "{\"w\":%d,\"h\":%d}", w, h);
    web_post_event("resize", tmp);
}

void
plat_resize(int w, int h, int monitor_index)
{
    if (monitor_index == 0)
        post_resize(w, h);
}

void
plat_resize_request(int w, int h, int monitor_index)
{
    if (video_fullscreen || is_quit)
        return;
    if (monitor_index == 0) {
        if (vid_resize & 2)
            plat_resize(fixed_size_x, fixed_size_y, 0);
        else
            plat_resize(w, h, 0);
    }
    atomic_store(&doresize_monitors[monitor_index], 0);
}

int
plat_vidapi(UNUSED(const char *api))
{
    return 0;
}

char *
plat_vidapi_name(UNUSED(int api))
{
    return "web";
}

void
plat_mouse_capture(int on)
{
    /* The UI owns pointer lock; ask it to (un)capture. */
    mouse_capture            = on;
    web_shared.mouse_capture = on;
    web_post_event("mouse_capture", on ? "1" : "0");
}

void
ui_init_monitor(UNUSED(int monitor_index))
{
}

void
ui_deinit_monitor(UNUSED(int monitor_index))
{
}

/* Shader paths are part of the shared configuration file; the web renderer
   does not use them but keeps them so they round-trip through config. */
char gl3_shader_file[20][512];
char vk_shader_file[20][512];
