/*
 * Web86Box - hardware catalog for the settings dialog.
 *
 * Serializes 86Box's machine, CPU and device tables (plus each device's
 * configuration schema) to JSON so the browser UI can offer the same
 * choices as the Qt settings dialog. Anything that needs 86Box logic to
 * decide (ROM availability, CPU eligibility, effective bus flags) is
 * evaluated here rather than re-implemented in JS.
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <86box/86box.h>
#include <86box/device.h>
#include <86box/thread.h>
#include <86box/timer.h>
#include <86box/mem.h>
#include <86box/machine.h>
#include <86box/rom.h>
#include <86box/video.h>
#include <86box/sound.h>
#include <86box/midi.h>
#include <86box/network.h>
#include <86box/hdc.h>
#include <86box/hdd.h>
#include <86box/fdc_ext.h>
#include <86box/fdd.h>
#include <86box/scsi.h>
#include <86box/cdrom.h>
#include <86box/cdrom_interface.h>
#include <86box/isamem.h>
#include <86box/isartc.h>
#include <86box/isarom.h>
#include <86box/mcamem.h>
#include <86box/mouse.h>
#include <86box/keyboard.h>
#include <86box/gameport.h>
#include <86box/char.h>
#include <86box/unittester.h>
#include <86box/novell_cardkey.h>
#include <86box/vid_ps55da2.h>
#include <86box/snd_mpu401.h>
#include <86box/vid_xga_device.h>
#include <86box/vid_8514a_device.h>
#include <86box/softpower.h>
#include "cpu.h"

#include "web_shared.h"
#include "web_json.h"

#define LIST_CAP 2048

static int
bios_available(const device_config_bios_t *bios)
{
    if (bios->files_no == -1)
        return 1;
    for (int d = 0; d < bios->files_no; d++)
        if (!rom_present(bios->files[d]))
            return 0;
    return 1;
}

static void
emit_config(jbuf_t *b, const device_config_t *cfg)
{
    jb_raw(b, "[");
    for (; cfg && cfg->name && cfg->type != CONFIG_END; cfg++) {
        jb_raw(b, "{");
        jb_key(b, "name");
        jb_str(b, cfg->name);
        jb_raw(b, ",");
        jb_key(b, "desc");
        jb_str(b, cfg->description);
        jb_raw(b, ",");
        jb_key(b, "type");
        jb_printf(b, "%d,", cfg->type);
        jb_key(b, "di");
        jb_printf(b, "%d,", cfg->default_int);
        if (cfg->default_string) {
            jb_key(b, "ds");
            jb_str(b, cfg->default_string);
            jb_raw(b, ",");
        }
        if (cfg->file_filter) {
            jb_key(b, "filter");
            jb_str(b, cfg->file_filter);
            jb_raw(b, ",");
        }
        if (cfg->spinner.min || cfg->spinner.max || cfg->spinner.step) {
            jb_key(b, "spin");
            jb_printf(b, "[%d,%d,%d],", cfg->spinner.min, cfg->spinner.max, cfg->spinner.step);
        }
        if (cfg->selection[0].description && cfg->selection[0].description[0]) {
            jb_key(b, "sel");
            jb_raw(b, "[");
            for (int i = 0; i < 64 && cfg->selection[i].description && cfg->selection[i].description[0]; i++) {
                jb_raw(b, "[");
                jb_str(b, cfg->selection[i].description);
                jb_printf(b, ",%d],", cfg->selection[i].value);
            }
            jb_close(b, ']');
            jb_raw(b, ",");
        }
        if ((cfg->type & CONFIG_TYPE_MASK) == CONFIG_BIOS) {
            jb_key(b, "bios");
            jb_raw(b, "[");
            for (int i = 0; i < 32; i++) {
                const device_config_bios_t *bios = &cfg->bios[i];
                if (!bios->name || !bios->internal_name || !bios->name[0] || !bios->internal_name[0] || !bios->files_no)
                    break;
                jb_raw(b, "[");
                jb_str(b, bios->name);
                jb_raw(b, ",");
                jb_str(b, bios->internal_name);
                jb_printf(b, ",%d],", bios_available(bios));
            }
            jb_close(b, ']');
            jb_raw(b, ",");
        }
        jb_close(b, '}');
        jb_raw(b, ",");
    }
    jb_close(b, ']');
}

/* One entry of a device list: {"i","n","s","f","a","c"}. */
static void
emit_device(jbuf_t *b, const char *internal, const device_t *dev, int avail)
{
    char name[512] = { 0 };

    jb_raw(b, "{");
    jb_key(b, "i");
    jb_str(b, internal);
    jb_raw(b, ",");

    if (internal && !strcmp(internal, "none"))
        strcpy(name, "None");
    else if (internal && !strcmp(internal, "internal"))
        strcpy(name, "Internal device");
    else if (dev) {
        char        temp[480] = { 0 };
        const char *bus;
        device_get_name(dev, -1, temp);
        bus = device_get_bus_name(dev);
        if (bus)
            snprintf(name, sizeof(name), "[%s] %s", bus, temp);
        else
            snprintf(name, sizeof(name), "%s", temp);
    }

    jb_key(b, "n");
    jb_str(b, name);
    jb_raw(b, ",");
    if (dev) {
        jb_key(b, "s");
        jb_str(b, dev->name);
        jb_raw(b, ",");
        jb_key(b, "f");
        jb_printf(b, "%u,", (unsigned) dev->flags);
    }
    jb_key(b, "a");
    jb_printf(b, "%d", avail);
    if (dev && dev->config && device_has_config(dev)) {
        jb_raw(b, ",");
        jb_key(b, "c");
        emit_config(b, dev->config);
    }
    jb_raw(b, "},");
}

typedef const char *(*name_fn_t)(int);
typedef const device_t *(*dev_fn_t)(int);
typedef int (*avail_fn_t)(int);

static void
emit_list(jbuf_t *b, const char *key, name_fn_t get_name, dev_fn_t get_dev, avail_fn_t get_avail)
{
    jb_key(b, key);
    jb_raw(b, "[");
    for (int c = 0; c < LIST_CAP; c++) {
        const char *internal = get_name(c);
        if (!internal)
            break;
        const device_t *dev   = get_dev ? get_dev(c) : NULL;
        int             avail = get_avail ? get_avail(c) : (dev ? device_available(dev) : 1);
        /* Some tables end with an empty entry instead of NULL. */
        if (!internal[0] && !dev)
            break;
        emit_device(b, internal, dev, avail);
    }
    jb_close(b, ']');
    jb_raw(b, ",");
}

/* Adapters for accessors whose signatures differ slightly. */
static const char *cdrom_if_name(int c) { return cdrom_interface_get_internal_name(c); }
static const device_t *cdrom_if_dev(int c) { return cdrom_interface_get_device(c); }
static int cdrom_if_avail(int c) { return cdrom_interface_available(c); }
static const char *gameport_name(int c) { return gameport_get_internal_name(c); }
static const device_t *gameport_dev(int c) { return gameport_get_device(c); }
static int gameport_avail(int c) { return gameport_available(c); }

static const char *
char_name(int c)
{
    const device_t *dev = char_get_device(c);
    return dev ? dev->internal_name : NULL;
}

static const device_t *
char_dev(int c)
{
    return char_get_device(c);
}

static void
emit_machines(jbuf_t *b)
{
    jb_key(b, "machine_types");
    jb_raw(b, "[");
    /* machine_types[] is indexed by type and ends with MACHINE_TYPE_MISC. */
    for (int t = 0; t < MACHINE_TYPE_MAX; t++) {
        jb_raw(b, "{");
        jb_key(b, "id");
        jb_printf(b, "%d,", (int) machine_types[t].id);
        jb_key(b, "name");
        jb_str(b, machine_types[t].name);
        jb_raw(b, "},");
        if (machine_types[t].id == MACHINE_TYPE_MISC)
            break;
    }
    jb_close(b, ']');
    jb_raw(b, ",");

    jb_key(b, "cpu_families");
    jb_raw(b, "[");
    int nfam = 0;
    for (const cpu_family_t *f = cpu_families; f->package; f++, nfam++) {
        jb_raw(b, "{");
        jb_key(b, "i");
        jb_str(b, f->internal_name);
        jb_raw(b, ",");
        jb_key(b, "n");
        jb_str(b, f->name);
        jb_raw(b, ",");
        jb_key(b, "m");
        jb_str(b, f->manufacturer);
        jb_raw(b, ",");
        jb_key(b, "cpus");
        jb_raw(b, "[");
        for (int c = 0; f->cpus[c].cpu_type; c++) {
            jb_raw(b, "{");
            jb_key(b, "n");
            jb_str(b, f->cpus[c].name);
            jb_raw(b, ",");
            jb_key(b, "s");
            jb_printf(b, "%u,", f->cpus[c].rspeed);
            jb_key(b, "x");
            jb_printf(b, "%g,", f->cpus[c].multi);
            /* Settings dialog rules from qt_settingsmachine.cpp. */
            const uint64_t t = f->cpus[c].cpu_type;
            jb_key(b, "ws");
            jb_printf(b, "%d,", (t >= CPU_286) && (t < CPU_386DX));
            jb_key(b, "oi");
            jb_printf(b, "%d,", !((t < CPU_286) || (t == CPU_IBM486SLC) || (t == CPU_IBM486BL)
                                  || !strcmp(f->manufacturer, "Cyrix") || !strcmp(f->manufacturer, "ST")
                                  || (t > CPU_486DLC)));
            jb_key(b, "fpus");
            jb_raw(b, "[");
            for (int p = 0; f->cpus[c].fpus && f->cpus[c].fpus[p].internal_name; p++) {
                jb_raw(b, "[");
                jb_str(b, f->cpus[c].fpus[p].name);
                jb_raw(b, ",");
                jb_str(b, f->cpus[c].fpus[p].internal_name);
                jb_printf(b, ",%d],", f->cpus[c].fpus[p].type);
            }
            jb_close(b, ']');
            jb_raw(b, "},");
        }
        jb_close(b, ']');
        jb_raw(b, "},");
    }
    jb_close(b, ']');
    jb_raw(b, ",");

    jb_key(b, "machines");
    jb_raw(b, "[");
    for (int m = 0; machine_get_internal_name_ex(m) != NULL; m++) {
        const machine_t *ms = &machines[m];

        jb_raw(b, "{");
        jb_key(b, "i");
        jb_str(b, ms->internal_name);
        jb_raw(b, ",");
        jb_key(b, "n");
        jb_str(b, ms->name);
        jb_raw(b, ",");
        jb_key(b, "t");
        jb_printf(b, "%u,", ms->type);
        jb_key(b, "a");
        jb_printf(b, "%d,", machine_available(m));
        /* Effective bus/flags as 86Box computes them (incl. implied ones). */
        /* 64-bit masks as strings: JS numbers only hold 53 bits. */
        jb_key(b, "bus");
        jb_printf(b, "\"%llu\",", (unsigned long long) machine_has_bus(m, (uintptr_t) -1));
        jb_key(b, "fl");
        jb_printf(b, "\"%llu\",", (unsigned long long) machine_has_flags_64(m, (uintptr_t) -1));
        jb_key(b, "ram");
        jb_printf(b, "[%u,%u,%d],", ms->ram.min, ms->ram.max, ms->ram.step);


        /* Eligible CPUs: [[family index, [cpu indexes...]], ...] */
        jb_key(b, "cpus");
        jb_raw(b, "[");
        int fi = 0;
        for (const cpu_family_t *f = cpu_families; f->package; f++, fi++) {
            int any = 0;
            for (int c = 0; f->cpus[c].cpu_type; c++) {
                if (cpu_is_eligible(f, c, m)) {
                    if (!any)
                        jb_printf(b, "[%d,[", fi);
                    jb_printf(b, "%d,", c);
                    any = 1;
                }
            }
            if (any) {
                jb_close(b, ']');
                jb_raw(b, "],");
            }
        }
        jb_close(b, ']');

        const device_t *dev = machine_get_device(m);
        if (dev && device_has_config(dev)) {
            jb_raw(b, ",");
            jb_key(b, "dev");
            jb_raw(b, "[");
            emit_device(b, dev->internal_name, dev, 1);
            jb_close(b, ']');
        }
        const device_t *vid = machine_get_vid_device(m);
        if (vid) {
            jb_raw(b, ",");
            jb_key(b, "vid");
            jb_raw(b, "[");
            emit_device(b, vid->internal_name, vid, 1);
            jb_close(b, ']');
        }
        const device_t *snd = machine_get_snd_device(m);
        if (snd) {
            jb_raw(b, ",");
            jb_key(b, "snd");
            jb_raw(b, "[");
            emit_device(b, snd->internal_name, snd, 1);
            jb_close(b, ']');
        }
        jb_raw(b, "},");
    }
    jb_close(b, ']');
    jb_raw(b, ",");
}

static void
emit_drives(jbuf_t *b)
{
    jb_key(b, "fdd_types");
    jb_raw(b, "[");
    for (int t = 0; fdd_get_internal_name(t) && fdd_get_internal_name(t)[0]; t++) {
        jb_raw(b, "[");
        jb_str(b, fdd_get_internal_name(t));
        jb_raw(b, ",");
        jb_str(b, fdd_getname(t));
        jb_raw(b, "],");
        if (t > 64)
            break;
    }
    jb_close(b, ']');
    jb_raw(b, ",");

    jb_key(b, "cdrom_types");
    jb_raw(b, "[");
    for (int t = 0; t < 1024; t++) {
        const char *in = cdrom_get_internal_name(t);
        if (!in || !in[0])
            break;
        char name[512] = { 0 };
        cdrom_get_name(t, name);
        jb_raw(b, "[");
        jb_str(b, in);
        jb_raw(b, ",");
        jb_str(b, name);
        jb_printf(b, ",%d,%d],", cdrom_drive_types[t].bus_type, cdrom_drive_types[t].is_dvd);
    }
    jb_close(b, ']');
    jb_raw(b, ",");

    jb_key(b, "hdd_presets");
    jb_raw(b, "[");
    for (int p = 0; p < hdd_preset_get_num(); p++) {
        jb_raw(b, "[");
        jb_str(b, hdd_preset_get_internal_name(p));
        jb_raw(b, ",");
        jb_str(b, hdd_preset_getname(p));
        jb_printf(b, ",%u],", hdd_preset_get_rpm(p));
    }
    jb_close(b, ']');
    jb_raw(b, ",");

    jb_key(b, "hdd_table");
    jb_raw(b, "[");
    for (int i = 0; i < 128 && hdd_table[i][0]; i++)
        jb_printf(b, "[%u,%u,%u],", hdd_table[i][0], hdd_table[i][1], hdd_table[i][2]);
    jb_close(b, ']');
    jb_raw(b, ",");

    jb_key(b, "joysticks");
    jb_raw(b, "[");
    /* The joystick table ends where the name becomes "". */
    for (int j = 0; joystick_get_internal_name(j) && joystick_get_internal_name(j)[0]; j++) {
        jb_raw(b, "{");
        jb_key(b, "i");
        jb_str(b, joystick_get_internal_name(j));
        jb_raw(b, ",");
        jb_key(b, "n");
        jb_str(b, joystick_get_name(j));
        jb_raw(b, ",");
        jb_key(b, "max");
        jb_printf(b, "%d,", joystick_get_max_joysticks(j));
        jb_key(b, "axes");
        jb_printf(b, "%d,", joystick_get_axis_count(j));
        jb_key(b, "buttons");
        jb_printf(b, "%d,", joystick_get_button_count(j));
        jb_key(b, "povs");
        jb_printf(b, "%d", joystick_get_pov_count(j));
        jb_raw(b, "},");
    }
    jb_close(b, ']');
    jb_raw(b, ",");
}

static void
emit_consts(jbuf_t *b)
{
    jb_key(b, "consts");
    jb_raw(b, "{");
#define C(x) jb_printf(b, "\"%s\":\"%llu\",", #x, (unsigned long long) (x))
    C(DEVICE_BUS);
    C(DEVICE_ISA);
    C(DEVICE_ISA16);
    C(DEVICE_MCA);
    C(DEVICE_EISA);
    C(DEVICE_VLB);
    C(DEVICE_PCI);
    C(DEVICE_AGP);
    C(DEVICE_AC97);
    C(DEVICE_COM);
    C(DEVICE_LPT);
    C(DEVICE_KBC);
    C(DEVICE_ONBOARD);
    C(MACHINE_PCI_INTERNAL);
    C(MACHINE_AGP_INTERNAL);
    C(MACHINE_BUS_ISA);
    C(MACHINE_BUS_ISA16);
    C(MACHINE_BUS_MCA);
    C(MACHINE_BUS_PCI);
    C(MACHINE_BUS_AGP);
    C(MACHINE_BUS_EISA);
    C(MACHINE_BUS_VLB);
    C(MACHINE_BUS_CASSETTE);
    C(MACHINE_BUS_SIDECAR);
    C(MACHINE_BUS_PS2_PORTS);
    C(MACHINE_VIDEO);
    C(MACHINE_VIDEO_ONLY);
    C(MACHINE_VIDEO_EXT);
    C(MACHINE_SOUND);
    C(MACHINE_NIC);
    C(MACHINE_NIC_PRI);
    C(MACHINE_NIC_SEC);
    C(MACHINE_MOUSE);
    C(MACHINE_KEYBOARD);
    C(MACHINE_FDC);
    C(MACHINE_HDC);
    C(MACHINE_SOFTFLOAT_ONLY);
    C(MACHINE_APM);
    C(MACHINE_ACPI);
    C(CONFIG_INT);
    C(CONFIG_BINARY);
    C(CONFIG_SELECTION);
    C(CONFIG_MIDI_OUT);
    C(CONFIG_SPINNER);
    C(CONFIG_MIDI_IN);
    C(CONFIG_MEMORY);
    C(CONFIG_STRING);
    C(CONFIG_FNAME);
    C(CONFIG_SERPORT);
    C(CONFIG_BIOS);
    C(CONFIG_HEX16);
    C(CONFIG_HEX20);
    C(CONFIG_MAC);
    C(CONFIG_DEP);
    C(CONFIG_TYPE_MASK);
    C(GFXCARD_MAX);
    C(SOUND_CARD_MAX);
    C(NET_CARD_MAX);
    C(HDC_MAX);
    C(SCSI_CARD_MAX);
    C(FDD_NUM);
    C(CDROM_NUM);
    C(HDD_NUM);
    C(SERIAL_MAX);
    C(PARALLEL_MAX);
    C(ISAMEM_MAX);
    C(GAMEPORT_MAX);
#undef C
    jb_close(b, '}');
    jb_raw(b, ",");
}

char *
web_catalog_json(void)
{
    jbuf_t b = { 0 };

    jb_raw(&b, "{");
    jb_key(&b, "version");
    jb_str(&b, EMU_VERSION_FULL);
    jb_raw(&b, ",");

    emit_consts(&b);
    emit_machines(&b);

    emit_list(&b, "video", (name_fn_t) video_get_internal_name, video_card_getdevice, video_card_available);
    emit_list(&b, "sound", (name_fn_t) sound_card_get_internal_name, sound_card_getdevice, sound_card_available);
    emit_list(&b, "midi_out", (name_fn_t) midi_out_device_get_internal_name, midi_out_device_getdevice, midi_out_device_available);
    emit_list(&b, "midi_in", (name_fn_t) midi_in_device_get_internal_name, midi_in_device_getdevice, midi_in_device_available);
    emit_list(&b, "network", (name_fn_t) network_card_get_internal_name, network_card_getdevice, network_card_available);
    emit_list(&b, "hdc", (name_fn_t) hdc_get_internal_name, hdc_get_device, hdc_available);
    emit_list(&b, "fdc", (name_fn_t) fdc_card_get_internal_name, fdc_card_getdevice, fdc_card_available);
    emit_list(&b, "scsi", (name_fn_t) scsi_card_get_internal_name, scsi_card_getdevice, scsi_card_available);
    emit_list(&b, "cdrom_interface", cdrom_if_name, cdrom_if_dev, cdrom_if_avail);
    emit_list(&b, "isamem", (name_fn_t) isamem_get_internal_name, isamem_get_device, NULL);
    emit_list(&b, "isartc", (name_fn_t) isartc_get_internal_name, isartc_get_device, NULL);
    emit_list(&b, "isarom", (name_fn_t) isarom_get_internal_name, isarom_get_device, NULL);
    emit_list(&b, "mcamem", (name_fn_t) mcamem_get_internal_name, mcamem_get_device, NULL);
    emit_list(&b, "mouse", (name_fn_t) mouse_get_internal_name, mouse_get_device, NULL);
    emit_list(&b, "tablet", (name_fn_t) tablet_get_internal_name, tablet_get_device, NULL);
    emit_list(&b, "keyboard", (name_fn_t) keyboard_get_internal_name, keyboard_get_device, NULL);
    emit_list(&b, "gameport", gameport_name, gameport_dev, gameport_avail);
    emit_list(&b, "char", char_name, char_dev, NULL);

    /* Standalone devices with their own Configure buttons. */
    jb_key(&b, "extra");
    jb_raw(&b, "{");
#define X(key, dev) jb_key(&b, key); jb_raw(&b, "["); emit_device(&b, (dev).internal_name, &(dev), device_available(&(dev))); jb_close(&b, ']'); jb_raw(&b, ",")
    X("voodoo", voodoo_device);
    X("8514a_isa", gen8514_isa_device);
    X("8514a_mca", ibm8514_mca_device);
    X("xga", xga_device);
    X("da2", ps55da2_device);
    X("mpu401", mpu401_device);
    X("mpu401_mca", mpu401_mca_device);
    X("unittester", unittester_device);
    X("softpower", softpower_device);
    X("novell_keycard", novell_keycard_device);
#undef X
    jb_close(&b, '}');
    jb_raw(&b, ",");

    emit_drives(&b);

    jb_close(&b, '}');
    return b.s;
}
