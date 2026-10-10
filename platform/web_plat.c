/*
 * Web86Box - platform services (files, paths, timers, strings).
 *
 * Derived from 86Box's src/unix/sdl_plat.c and sdl_plat_unix.c.
 */
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>


#include <86box/86box.h>
#include <86box/timer.h>
#include <86box/nvr.h>
#include <86box/config.h>
#include <86box/hdc_ide.h>
#include <86box/hdd.h>
#include <86box/path.h>
#include <86box/plat.h>
#include <86box/ui.h>
#include <86box/version.h>
#include "cpu.h"

#include <86box/plat_unused.h>
#include <86box/mem.h>
#include <86box/rom.h>
#include <86box/video.h>

#include <emscripten.h>
#include <emscripten/threading.h>
#include <errno.h>
#include <sys/time.h>
#include <time.h>

#include "web_shared.h"

/*
 * File system manipulation
 */

int
plat_getcwd(char *bufp, int max)
{
    return getcwd(bufp, max) != 0;
}

int
plat_chdir(char *str)
{
    return chdir(str);
}

FILE *
plat_fopen(const char *path, const char *mode)
{
    return fopen(path, mode);
}

FILE *
plat_fopen64(const char *path, const char *mode)
{
    return fopen(path, mode);
}

int
plat_dir_check(char *path)
{
    struct stat stats;
    int         known = web_rom_dir_known(path);
    if (known >= 0)
        return known;
    if (stat(path, &stats) < 0)
        return 0;
    return S_ISDIR(stats.st_mode);
}

int
plat_file_check(const char *path)
{
    struct stat stats;
    /* ROMs live on a lazily fetched filesystem: answer from the manifest
       so that probing every machine's ROMs costs no network requests. */
    int         known = web_rom_known(path);
    if (known >= 0)
        return known;
    if (stat(path, &stats) < 0)
        return 0;
    return !S_ISDIR(stats.st_mode);
}

int
plat_dir_create(char *path)
{
    return mkdir(path, S_IRWXU);
}

void
plat_remove(char *path)
{
    remove(path);
}

/*
 * String localization
 */

char *
plat_get_string(int i)
{
    switch (i) {
        case STRING_PCAP_ERROR_NO_DEVICES:
            return "No PCap devices found. Make sure libpcap is installed and that you are on a libpcap-compatible network connection.";
        case STRING_PCAP_ERROR_INVALID_DEVICE:
            return "Invalid PCap device. Make sure libpcap is installed and that you are on a libpcap-compatible network connection.";
        case STRING_GHOSTSCRIPT_ERROR:
            return "Unable to initialize Ghostscript. libgs is required for automatic conversion of PostScript files to PDF.\n\nAny documents sent to the generic PostScript printer will be saved as PostScript (.ps) files.";
        case STRING_GHOSTPCL_ERROR:
            return "Unable to initialize GhostPCL. libgpcl6 is required for automatic conversion of PCL files to PDF.\n\nAny documents sent to the generic PCL printer will be saved as Printer Command Language (.pcl) files.";
        case STRING_HW_NOT_AVAILABLE_MACHINE:
            return "Machine \"%s\" is not available due to missing ROMs in the roms/machines directory. Switching to an available machine.";
        case STRING_HW_NOT_AVAILABLE_VIDEO:
            return "Video card \"%s\" is not available due to missing ROMs in the roms/video directory. Switching to an available video card.";
        case STRING_HW_NOT_AVAILABLE_DEVICE:
            return "Device \"%s\" is not available due to missing ROMs. Ignoring the device.";
        case STRING_HW_NOT_AVAILABLE_TITLE:
            return "Hardware not available";
        case STRING_UNSUPPORTED_TITLE:
            return "Unsupported Hardware";
        case STRING_UNSUPPORTED_TEXT:
            return "Hardware in this machine profile is not supported by this current build of 86Box.";
        case STRING_UNSUPPORTED_OTHERS:
            return "(and %i others)";
        case STRING_UNSUPPORTED_REPLACE:
            return "Loading the configuration anyway will replace the machine and overwrite the existing configuration.";
        case STRING_UNSUPPORTED_REMOVE:
            return "Loading the configuration anyway will remove these components and overwrite the existing configuration.";
        case STRING_UNSUPPORTED_REPLACE_REMOVE:
            return "Loading the configuration anyway will replace the machine, remove the other components and overwrite the existing configuration.";
        case STRING_UNSUPPORTED_CONTINUE:
            return "Do you want to continue?";
        case STRING_UNSUPPORTED_MACHINE:
            return "Machine type \"%s\"";
        case STRING_UNSUPPORTED_VIDEO:
            return "Video card \"%s\"";
        case STRING_UNSUPPORTED_KEYBOARD:
            return "Keyboard \"%s\"";
        case STRING_UNSUPPORTED_MOUSE:
            return "Mouse \"%s\"";
        case STRING_UNSUPPORTED_TABLET:
            return "Tablet \"%s\"";
        case STRING_UNSUPPORTED_JOYSTICK:
            return "Joystick \"%s\"";
        case STRING_UNSUPPORTED_SOUND:
            return "Sound card \"%s\"";
        case STRING_UNSUPPORTED_MIDI_OUT:
            return "MIDI output device \"%s\"";
        case STRING_UNSUPPORTED_MIDI_IN:
            return "MIDI input device \"%s\"";
        case STRING_UNSUPPORTED_NETWORK:
            return "Network card \"%s\"";
        case STRING_UNSUPPORTED_SERIAL:
            return "Serial port device \"%s\"";
        case STRING_UNSUPPORTED_PARALLEL:
            return "Parallel port device \"%s\"";
        case STRING_UNSUPPORTED_GAMEPORT:
            return "Game port \"%s\"";
        case STRING_UNSUPPORTED_SCSI:
            return "SCSI card \"%s\"";
        case STRING_UNSUPPORTED_FDC:
            return "Floppy controller \"%s\"";
        case STRING_UNSUPPORTED_HDC:
            return "Disk controller \"%s\"";
        case STRING_UNSUPPORTED_CDROM_INTERFACE:
            return "CD-ROM interface \"%s\"";
        case STRING_UNSUPPORTED_MEMORY:
            return "Memory expansion card \"%s\"";
        case STRING_UNSUPPORTED_ROM:
            return "ROM expansion card \"%s\"";
        case STRING_UNSUPPORTED_RTC:
            return "RTC card \"%s\"";
        case STRING_NET_ERROR:
            return "Failed to initialize network driver:\n\n%s\n\nThe network configuration will be switched to the null driver.";
        case STRING_ESCP_ERROR:
            return "Unable to find Dot-Matrix fonts. TrueType fonts in the \"roms/printer/fonts\" directory are required for the emulation of the Generic ESC/P 2 Dot-Matrix Printer.";
        case STRING_EDID_READ_ERROR:
            return "EDID file \"%s\" is invalid.";
        case STRING_EDID_TOO_LARGE:
            return "EDID file \"%s\" is too large.";
        case STRING_CDROM_OPEN_ISO_ERROR:
            return "Unable to open image or folder \"%s\".";
        case STRING_CDROM_OPEN_CUE_ERROR:
            return "Unable to open cue sheet \"%s\".";
        case STRING_CDROM_OPEN_MDS_ERROR:
            return "Unable to open MDS file \"%s\".";
        case STRING_CDROM_LOAD_IMAGE_ERROR:
            return "Unable to load CD-ROM image \"%s\".";
        case STRING_CDROM_LOAD_MDSX_ERROR:
            return "Unable to load image \"%s\": mdsx.so is missing, which is required for Daemon Tools MDS v2 and MDX image support.";
        case STRING_CDROM_LOAD_AARU_ERROR:
            return "Unable to load image \"%s\": libaaruformat.so is missing, which is required for Aaru format image support.";
        case STRING_CDROM_DVD_IN_CD_DRIVE:
            return "The DVD image \"%s\" has been inserted into a drive that does not support DVD media and will be ignored.";
        case STRING_CHARDEV_CONNECT_ERROR:
            return "%s: Could not connect to %s: %s";
        case STRING_CHARDEV_CREATE_ERROR:
            return "%s: Could not create %s: %s";
        case STRING_CHARDEV_ATTACHED:
            return "%s: Attached to %s";
        case STRING_CHARDEV_VCON_IN_USE:
            return "%s: Virtual console already in use by %s";
        case STRING_CHARDEV_TERMINAL_ERROR:
            return "%s: Could not create terminal: %s";
    }
    return "";
}

/* Converts the language code string to a numeric language ID */
int
plat_language_code(UNUSED(char *langcode))
{
    /* or maybe not */
    return 0;
}

/* Converts the numeric language ID to a language code string */
void
plat_language_code_r(UNUSED(int id), UNUSED(char *outbuf), UNUSED(int len))
{
    /* or maybe not */
    return;
}

/*
 * Path manipulation
 */

void
path_slash(char *path)
{
    if (path[strlen(path) - 1] != '/') {
        strcat(path, "/");
    }
    path_normalize(path);
}

const char *
path_get_slash(char *path)
{
    char *ret = "";

    if (path[strlen(path) - 1] != '/')
        ret = "/";

    return ret;
}

/* Return the last element of a pathname. */
char *
path_get_basename(const char *path)
{
    int c = (int) strlen(path);

    while (c > 0) {
        if (path[c] == '/')
            return ((char *) &path[c + 1]);
        c--;
    }

    return ((char *) path);
}

char *
path_get_filename(char *s)
{
    int c = strlen(s) - 1;

    while (c > 0) {
        if (s[c] == '/' || s[c] == '\\')
            return (&s[c + 1]);
        c--;
    }

    return s;
}

char *
path_get_extension(char *s)
{
    int c = strlen(s) - 1;

    if (c <= 0)
        return s;

    while (c && s[c] != '.')
        c--;

    if (!c)
        return (&s[strlen(s)]);

    return (&s[c + 1]);
}

void
path_append_filename(char *dest, const char *s1, const char *s2)
{
    strcpy(dest, s1);
    path_slash(dest);
    strcat(dest, s2);
}

void
path_get_dirname(char *dest, const char *path)
{
    int   c   = (int) strlen(path);
    char *ptr = (char *) path;

    while (c > 0) {
        if (path[c] == '/' || path[c] == '\\') {
            ptr = (char *) &path[c];
            break;
        }
        c--;
    }

    /* Copy to destination. */
    while (path < ptr)
        *dest++ = *path++;
    *dest = '\0';
}

/*
 * Common locations
 */

void
plat_get_exe_name(char *s, int size)
{
    snprintf(s, size, "/" EMU_NAME);
}

void
plat_get_global_config_dir(char *outbuf, const size_t len)
{
    return plat_get_global_data_dir(outbuf, len);
}

void
plat_get_vmm_dir(char *outbuf, const size_t len)
{
    /* No VM manager directory on the web. */
    if (len > 0)
        outbuf[0] = 0;
}

/*
 * Timer functions
 */

/* emscripten_get_now() is epoch-based in workers, which does not fit the
   32-bit tick counter; count from the first use instead. */
static double
web_elapsed_ms(void)
{
    static double base = 0.0;
    double        now  = emscripten_get_now();

    if (base == 0.0)
        base = now;
    return now - base;
}

uint64_t
plat_timer_read(void)
{
    /* Microseconds; do_start() sets timer_freq to match. */
    return (uint64_t) (web_elapsed_ms() * 1000.0);
}

uint32_t
plat_get_ticks(void)
{
    return (uint32_t) (uint64_t) web_elapsed_ms();
}

void
plat_delay_ms(uint32_t count)
{
    emscripten_thread_sleep(count);
}

/*
 * Emulator support
 */

void
plat_power_off(void)
{
    confirm_exit_cmdl = 0;
    ide_wait_for_async_reads();
    hdd_image_sync_all();
    nvr_save();
    config_save();

    /* Deduct a sufficiently large number of cycles that no instructions will
       run before the main thread is terminated */
    cycles -= 99999999;

    cpu_thread_run = 0;
}

void
plat_pause(int p)
{
    static char oldtitle[512];
    char        title[512];

    if ((!!p) == dopause)
        return;

    if ((p == 0) && (time_sync & TIME_SYNC_ENABLED))
        nvr_time_sync();

    do_pause(p);
    web_shared.paused = !!p;
    if (p) {
        strncpy(oldtitle, ui_window_title(NULL), sizeof(oldtitle) - 1);
        strcpy(title, oldtitle);
        strcat(title, " - PAUSED");
        ui_window_title(title);
    } else {
        ui_window_title(oldtitle);
    }
}

void
plat_get_cpu_string(char *outbuf, uint8_t len)
{
    char cpu_string[] = "WebAssembly";

    strncpy(outbuf, cpu_string, len);
}

/*
 * Miscellaneous functions
 */

int
stricmp(const char *s1, const char *s2)
{
    return strcasecmp(s1, s2);
}

int
strnicmp(const char *s1, const char *s2, size_t n)
{
    return strncasecmp(s1, s2, n);
}

/*
 * Common filesystem locations
 *
 *   /roms   ROM set, fetched lazily over HTTP (see web_fs.c)
 *   /opfs   Origin Private File System: VMs and disk images persist here
 *   /tmp    scratch (memory)
 */

void
plat_tempfile(char *bufp, char *prefix, char *suffix)
{
    struct tm     *calendertime;
    struct timeval t;
    time_t         curtime;

    gettimeofday(&t, NULL);
    curtime      = time(NULL);
    calendertime = localtime(&curtime);

    sprintf(bufp, "%s%s%d%02d%02d-%02d%02d%02d-%03d%s",
            prefix ? prefix : "", prefix ? "-" : "",
            calendertime->tm_year, calendertime->tm_mon, calendertime->tm_mday,
            calendertime->tm_hour, calendertime->tm_min, calendertime->tm_sec,
            (int) (t.tv_usec / 1000), suffix);
}

void
plat_get_global_data_dir(char *outbuf, const size_t len)
{
    if (len == 0)
        return;
    strncpy(outbuf, "/opfs/global/", len);
    outbuf[len - 1] = '\0';
    if (!plat_dir_check(outbuf))
        plat_dir_create(outbuf);
}

void
plat_get_temp_dir(char *outbuf, uint8_t len)
{
    strncpy(outbuf, "/tmp/", len);
}

void
plat_init_rom_paths(void)
{
    rom_add_path("/roms/");
}

void
plat_init_asset_paths(void)
{
    asset_add_path("/roms/");
}

void
plat_get_system_directory(char *outbuf)
{
    strcpy(outbuf, "/");
}

/*
 * Path manipulation
 */

int
path_abs(char *path)
{
    return path[0] == '/';
}

void
path_normalize(UNUSED(char *path))
{
    /* No-op. */
}

/*
 * Block devices: none in a browser.
 */

int
plat_is_block_device(UNUSED(const char *path))
{
    return 0;
}

int64_t
plat_get_block_device_size(UNUSED(const char *path))
{
    return -1;
}

plat_device_vol_locked_t *
plat_lock_volumes(UNUSED(FILE *file))
{
    return NULL;
}

void
plat_unlock_volumes(UNUSED(plat_device_vol_locked_t *vol))
{
}

/*
 * Memory management: no executable memory on the web (no dynarec), so
 * plain zeroed allocations do.
 */

void *
plat_mmap(size_t size, UNUSED(uint8_t executable), uint8_t *large)
{
    if (large)
        *large = 0;
    return calloc(1, size);
}

void
plat_munmap(void *ptr, UNUSED(size_t size))
{
    free(ptr);
}

/*
 * Threads
 */

void
plat_set_thread_name(UNUSED(void *thread), UNUSED(const char *name))
{
    /* Worker names are fixed at creation in browsers. */
}

void
plat_break(void)
{
    emscripten_debugger();
}

int
plat_run_command(UNUSED(const char *cmd), UNUSED(const char **env), UNUSED(const char *title))
{
    return 0;
}

void
plat_clean_up(void)
{
}
