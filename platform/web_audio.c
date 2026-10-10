/*
 * Web86Box - sound output backend.
 *
 * Replaces 86Box's OpenAL backend (src/sound/openal.c). Every 86Box sound
 * source (main PCM, music/OPL, wavetable, CD audio, floppy and hard disk
 * noises, MIDI) gets its own single-producer/single-consumer ring of
 * stereo float frames in shared memory. The AudioWorklet
 * (web/js/audio-worklet.js) reads every ring directly from the wasm
 * memory, resamples each source to the AudioContext rate and mixes them.
 */
#include <math.h>
#include <stdatomic.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <86box/86box.h>
#include <86box/midi.h>
#include <86box/sound.h>
#include <86box/plat_unused.h>

#include "web_shared.h"

static web_audio_ring_t *rings[WEB_AUDIO_SOURCES];
static int               initialized = 0;

void
al_set_midi(const int freq, const int buf_size)
{
    midi_freq     = freq;
    midi_buf_size = buf_size;
}

static uint32_t
source_rate(int src)
{
    switch (src) {
        case I_NORMAL:
        case I_FDD:
        case I_HDD:
            return sound_sample_rate;
        case I_MUSIC:
            return MUSIC_FREQ;
        case I_WT:
            return WT_FREQ;
        case I_CD:
            return CD_FREQ;
        case I_YM2151:
            return YM2151_FREQ;
        case I_MIDI:
            return midi_freq;
        default:
            return 0;
    }
}

void
inital(void)
{
    if (initialized)
        return;

    for (int i = 0; i < I_MAX && i < WEB_AUDIO_SOURCES; i++) {
        if (!rings[i]) {
            rings[i] = calloc(1, sizeof(web_audio_ring_t));
            rings[i]->size = WEB_AUDIO_FRAMES;
        }
        __atomic_store_n(&rings[i]->rate, source_rate(i), __ATOMIC_RELEASE);
        __atomic_store_n(&web_shared.audio_ring_ptr[i], (uint32_t) (uintptr_t) rings[i], __ATOMIC_RELEASE);
    }

    initialized = 1;
}

void
closeal(void)
{
    if (!initialized)
        return;

    /* Keep the rings allocated (the worklet may still be reading them),
       just mark them inactive. */
    for (int i = 0; i < I_MAX && i < WEB_AUDIO_SOURCES; i++)
        if (rings[i])
            __atomic_store_n(&rings[i]->rate, 0, __ATOMIC_RELEASE);

    initialized = 0;
}

void
givealbuffer_common(const void *buf, const uint8_t src, const int size)
{
    if (!initialized || fast_forward || src >= WEB_AUDIO_SOURCES || !rings[src])
        return;

    web_audio_ring_t *r      = rings[src];
    const uint32_t    frames = (uint32_t) size / 2;
    const uint32_t    rate   = source_rate(src);

    if (r->rate != rate)
        __atomic_store_n(&r->rate, rate, __ATOMIC_RELEASE);

    uint32_t w     = __atomic_load_n(&r->write_pos, __ATOMIC_ACQUIRE);
    uint32_t rd    = __atomic_load_n(&r->read_pos, __ATOMIC_ACQUIRE);
    uint32_t space = r->size - (w - rd);

    /* If the consumer is not keeping up (tab in background, audio context
       suspended), drop this block rather than overwrite unread audio. */
    if (frames > space)
        return;

    const float gain = sound_muted ? 0.0f : (float) pow(10.0, (double) sound_gain / 20.0);

    for (uint32_t i = 0; i < frames; i++) {
        uint32_t idx = ((w + i) % r->size) * 2;
        if (sound_is_float) {
            const float *f    = (const float *) buf;
            r->data[idx]     = f[i * 2] * gain;
            r->data[idx + 1] = f[i * 2 + 1] * gain;
        } else {
            const int16_t *s  = (const int16_t *) buf;
            r->data[idx]     = (s[i * 2] / 32768.0f) * gain;
            r->data[idx + 1] = (s[i * 2 + 1] / 32768.0f) * gain;
        }
    }

    __atomic_store_n(&r->write_pos, w + frames, __ATOMIC_RELEASE);
}

/* --- Device enumeration and capture: not supported (yet) ------------- */

const char *
sound_get_output_devices(void)
{
    return NULL;
}

const char *
sound_get_input_devices(void)
{
    return NULL;
}

int
sound_get_device_sample_rate(UNUSED(const char *device_name))
{
    return 0;
}

int
sound_get_device_supported_rates(UNUSED(const char *device_name), UNUSED(int *rates_out), UNUSED(int max_rates))
{
    return 0;
}

void
al_capture_open(void)
{
}

void
al_capture_close(void)
{
}

int
al_capture_get_rate(void)
{
    return 0;
}

int
al_capture_available(void)
{
    return 0;
}

void
al_capture_start(void)
{
}

void
al_capture_stop(void)
{
}

void
al_capture_get_data(UNUSED(int16_t *buf), size_t *len)
{
    if (len)
        *len = 0;
}
