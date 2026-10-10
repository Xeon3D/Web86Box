/*
 * Web86Box - filesystem layout (WasmFS).
 *
 *   /roms  fetch backend: each ROM file is downloaded from
 *          <rom base url>/<path> the first time it is read. The list of
 *          files comes from <rom base url>/manifest.txt, generated when the
 *          site is built (tools/gen-rom-manifest.sh).
 *   /opfs  Origin Private File System backend: VM folders, configuration,
 *          NVRAM and disk images, persisted by the browser.
 *   /tmp   memory backend.
 */
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include <emscripten/wasmfs.h>

#include <86box/86box.h>
#include <86box/plat.h>

#include "web_shared.h"

#define ROM_ROOT "/roms"

/* --- A small string hash set for the manifest ------------------------- */

typedef struct strset_t {
    char   **slots;
    size_t   cap;
    size_t   count;
} strset_t;

static strset_t rom_files;
static strset_t rom_dirs;

static uint32_t
str_hash(const char *s)
{
    uint32_t h = 2166136261u;
    while (*s)
        h = (h ^ (uint8_t) *s++) * 16777619u;
    return h;
}

static void strset_add(strset_t *set, const char *s);

static void
strset_grow(strset_t *set)
{
    strset_t n = { calloc(set->cap ? set->cap * 2 : 1024, sizeof(char *)), set->cap ? set->cap * 2 : 1024, 0 };

    for (size_t i = 0; i < set->cap; i++) {
        if (set->slots[i]) {
            strset_add(&n, set->slots[i]);
            free(set->slots[i]);
        }
    }
    free(set->slots);
    *set = n;
}

static int
strset_has(const strset_t *set, const char *s)
{
    if (!set->cap)
        return 0;
    for (size_t i = str_hash(s) & (set->cap - 1);; i = (i + 1) & (set->cap - 1)) {
        if (!set->slots[i])
            return 0;
        if (!strcmp(set->slots[i], s))
            return 1;
    }
}

static void
strset_add(strset_t *set, const char *s)
{
    if ((set->count + 1) * 2 > set->cap)
        strset_grow(set);
    if (strset_has(set, s))
        return;
    size_t i = str_hash(s) & (set->cap - 1);
    while (set->slots[i])
        i = (i + 1) & (set->cap - 1);
    set->slots[i] = strdup(s);
    set->count++;
}

/* Collapse "//" and strip a trailing "/" so lookups match the manifest. */
static void
canon_path(const char *in, char *out, size_t len)
{
    size_t o = 0;

    for (const char *p = in; *p && o + 1 < len; p++) {
        if (*p == '/' && o && out[o - 1] == '/')
            continue;
        out[o++] = (*p == '\\') ? '/' : *p;
    }
    while (o > 1 && out[o - 1] == '/')
        o--;
    out[o] = '\0';
}

static int
is_rom_path(const char *canon)
{
    return !strncmp(canon, ROM_ROOT, sizeof(ROM_ROOT) - 1)
        && (canon[sizeof(ROM_ROOT) - 1] == '/' || canon[sizeof(ROM_ROOT) - 1] == '\0');
}

int
web_rom_known(const char *path)
{
    char canon[1024];

    if (!rom_files.cap)
        return -1;
    canon_path(path, canon, sizeof(canon));
    if (!is_rom_path(canon))
        return -1;
    return strset_has(&rom_files, canon);
}

int
web_rom_dir_known(const char *path)
{
    char canon[1024];

    if (!rom_files.cap)
        return -1;
    canon_path(path, canon, sizeof(canon));
    if (!is_rom_path(canon))
        return -1;
    return !strcmp(canon, ROM_ROOT) || strset_has(&rom_dirs, canon);
}

/* --- Setup -------------------------------------------------------------- */

static void
mkdir_p(const char *path)
{
    char tmp[1024];

    snprintf(tmp, sizeof(tmp), "%s", path);
    for (char *p = tmp + 1; *p; p++) {
        if (*p == '/') {
            *p = '\0';
            mkdir(tmp, 0777);
            *p = '/';
        }
    }
    mkdir(tmp, 0777);
}

static char *
read_whole_file(const char *path, size_t *out_len)
{
    FILE *fp = fopen(path, "rb");
    if (!fp)
        return NULL;

    size_t cap = 65536, len = 0;
    char  *buf = malloc(cap);
    size_t n;
    while ((n = fread(buf + len, 1, cap - len - 1, fp)) > 0) {
        len += n;
        if (cap - len < 4096) {
            cap *= 2;
            buf = realloc(buf, cap);
        }
    }
    fclose(fp);
    buf[len] = '\0';
    if (out_len)
        *out_len = len;
    return buf;
}

static int
load_rom_manifest(void)
{
    const char *manifest_path = ROM_ROOT "/manifest.txt";
    int         fd            = open(manifest_path, O_CREAT | O_RDONLY, 0444);

    if (fd < 0) {
        fprintf(stderr, "web_fs: cannot create %s (%d)\n", manifest_path, errno);
        return 0;
    }
    close(fd);

    size_t len;
    char  *text = read_whole_file(manifest_path, &len);
    if (!text || !len) {
        fprintf(stderr, "web_fs: ROM manifest is empty or could not be fetched\n");
        free(text);
        return 0;
    }

    int   files = 0;
    char *save  = NULL;
    for (char *line = strtok_r(text, "\r\n", &save); line; line = strtok_r(NULL, "\r\n", &save)) {
        while (*line == ' ' || *line == '.' || *line == '/')
            line++;
        if (!*line || *line == '#')
            continue;

        char full[1024];
        snprintf(full, sizeof(full), ROM_ROOT "/%s", line);

        /* Register and create every parent directory. */
        for (char *p = full + sizeof(ROM_ROOT); *p; p++) {
            if (*p == '/') {
                *p = '\0';
                if (!strset_has(&rom_dirs, full)) {
                    strset_add(&rom_dirs, full);
                    mkdir(full, 0777);
                }
                *p = '/';
            }
        }

        /* Creating the file in the fetch backend does not download it. */
        int f = open(full, O_CREAT | O_RDONLY, 0444);
        if (f >= 0) {
            close(f);
            strset_add(&rom_files, full);
            files++;
        }
    }
    free(text);

    fprintf(stderr, "web_fs: %d ROM files in manifest\n", files);
    return files > 0;
}

int
web_fs_init(const char *rom_base_url)
{
    backend_t fetch = wasmfs_create_fetch_backend(rom_base_url, 0);
    if (!fetch || wasmfs_create_directory(ROM_ROOT, 0777, fetch) != 0) {
        fprintf(stderr, "web_fs: cannot mount %s\n", ROM_ROOT);
        return 0;
    }

    backend_t opfs = wasmfs_create_opfs_backend();
    if (!opfs || wasmfs_create_directory("/opfs", 0777, opfs) != 0) {
        /* Fall back to memory so the emulator still runs (no persistence). */
        fprintf(stderr, "web_fs: OPFS unavailable, VMs will not persist\n");
        mkdir("/opfs", 0777);
    }

    mkdir_p("/tmp");
    mkdir_p("/opfs/vms");

    return load_rom_manifest();
}
