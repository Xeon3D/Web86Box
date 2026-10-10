/*
 * Web86Box - state shared between the emulator (wasm threads) and the
 * browser UI (JS on the main thread and in the AudioWorklet).
 *
 * The JS side reads this structure straight out of the wasm memory
 * (a SharedArrayBuffer), so the layout is fixed: every field is a 32-bit
 * word, and web/js/shared.js mirrors the word offsets below. Bump
 * WEB_SHARED_VERSION whenever the layout changes.
 */
#ifndef WEB86BOX_SHARED_H
#define WEB86BOX_SHARED_H

#include <stdint.h>

#define WEB_SHARED_MAGIC   0x57383642u /* "W86B" */
#define WEB_SHARED_VERSION 1

#define WEB_FB_COUNT  3
#define WEB_FB_MAX_W  2048
#define WEB_FB_MAX_H  1536

#define WEB_AUDIO_SOURCES 8
#define WEB_AUDIO_FRAMES  16384 /* per source ring, stereo frames */

/* Framebuffer "ready" word: low bits index the buffer, this bit marks a
   frame the UI has not picked up yet (triple buffering by exchange). */
#define WEB_FB_NEW 0x100u

typedef struct web_audio_ring_t {
    uint32_t write_pos; /* frames written (monotonic, wraps at 2^32) */
    uint32_t read_pos;  /* frames consumed by the AudioWorklet */
    uint32_t size;      /* ring capacity in frames */
    uint32_t rate;      /* source sample rate in Hz, 0 = inactive */
    float    data[WEB_AUDIO_FRAMES * 2];
} web_audio_ring_t;

typedef struct web_shared_t {
    /* 0 */ uint32_t magic;
    /* 1 */ uint32_t version;

    /* Video. */
    /* 2 */ uint32_t fb_ready;                /* WEB_FB_NEW | index */
    /* 3 */ uint32_t fb_ptr[WEB_FB_COUNT];    /* RGBA8888, row stride = width */
    /* 6 */ uint32_t fb_w[WEB_FB_COUNT];
    /* 9 */ uint32_t fb_h[WEB_FB_COUNT];
    /* 12 */ uint32_t frame_count;

    /* Audio. */
    /* 13 */ uint32_t audio_ring_ptr[WEB_AUDIO_SOURCES];
    /* 21 */ uint32_t audio_gain_milli;       /* 1000 = unity */

    /* Emulator status. */
    /* 22 */ uint32_t state;                  /* see WEB_STATE_* */
    /* 23 */ uint32_t speed_percent;
    /* 24 */ uint32_t paused;
    /* 25 */ uint32_t mouse_capture;          /* emulator-side capture flag */
    /* 26 */ uint32_t status_seq;             /* bumped when sb_* change */
    /* 27 */ uint32_t kbd_leds;               /* bit0 num, bit1 caps, bit2 scroll */
    /* 28 */ uint32_t reserved[4];

    /* Status bar icons, indexed by SB_* tag (type | drive). One byte each,
       packed four per word. */
    /* 32 */ uint8_t sb_active[256];
    /* 96 */ uint8_t sb_write[256];
    /* 160 */ uint8_t sb_empty[256];
    /* 224 */ uint8_t sb_wp[256];
} web_shared_t;

enum {
    WEB_STATE_BOOT = 0,     /* filesystem / ROM manifest setup */
    WEB_STATE_WAITING = 1,  /* waiting for a VM to be selected */
    WEB_STATE_RUNNING = 2,
    WEB_STATE_STOPPED = 3,
    WEB_STATE_ERROR = 4,
};

extern web_shared_t web_shared;

/* Window title (declared by the frontends rather than 86Box headers). */
extern char *ui_window_title(char *str);

/* Post an event to the browser UI: Module.web86box.onEvent(type, payload). */
extern void web_post_event(const char *type, const char *payload);

/* Filesystem setup (web_fs.c). */
extern int  web_fs_init(const char *rom_base_url);
extern int  web_rom_known(const char *path);
extern int  web_rom_dir_known(const char *path);

/* Catalog of emulated hardware for the settings dialog (web_catalog.c). */
extern char *web_catalog_json(void);

/* Video (web_video.c). */
extern void web_video_init(void);
extern void web_video_close(void);

#endif
