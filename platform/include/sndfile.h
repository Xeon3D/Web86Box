/*
 * Web86Box - minimal libsndfile stand-in.
 *
 * libsndfile is not built for the web. 86Box only uses it to decode audio
 * tracks of CD images in formats other than raw/WAV; this stub makes such
 * tracks fail to open (they play as silence) without patching 86Box.
 */
#ifndef WEB86BOX_SNDFILE_STUB_H
#define WEB86BOX_SNDFILE_STUB_H

#include <stdint.h>
#include <stddef.h>

typedef int64_t sf_count_t;
typedef struct SNDFILE_tag SNDFILE;

typedef struct SF_INFO {
    sf_count_t frames;
    int        samplerate;
    int        channels;
    int        format;
    int        sections;
    int        seekable;
} SF_INFO;

#define SFM_READ  0x10
#define SFM_WRITE 0x20
#define SFM_RDWR  0x30

#define SF_FORMAT_WAV      0x010000
#define SF_FORMAT_PCM_16   0x0002
#define SF_FORMAT_TYPEMASK 0x0FFF0000
#define SF_FORMAT_SUBMASK  0x0000FFFF

#ifndef SEEK_SET
#    define SEEK_SET 0
#endif

static inline SNDFILE *sf_open(const char *path, int mode, SF_INFO *info) { (void) path; (void) mode; (void) info; return NULL; }
static inline int sf_close(SNDFILE *f) { (void) f; return 0; }
static inline sf_count_t sf_seek(SNDFILE *f, sf_count_t frames, int whence) { (void) f; (void) frames; (void) whence; return -1; }
static inline sf_count_t sf_readf_short(SNDFILE *f, short *ptr, sf_count_t frames) { (void) f; (void) ptr; (void) frames; return 0; }
static inline sf_count_t sf_read_short(SNDFILE *f, short *ptr, sf_count_t items) { (void) f; (void) ptr; (void) items; return 0; }
static inline const char *sf_strerror(SNDFILE *f) { (void) f; return "libsndfile is not available"; }

#endif
