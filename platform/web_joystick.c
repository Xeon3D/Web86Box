/*
 * Web86Box - joysticks via the browser Gamepad API.
 *
 * The UI polls navigator.getGamepads() every animation frame and pushes
 * each pad's state with web_joystick_update(). Mapping onto the emulated
 * game port follows src/qt/sdl_joystick.c.
 */
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include <emscripten.h>

#include <86box/86box.h>
#include <86box/device.h>
#include <86box/gameport.h>
#include <86box/plat_unused.h>

#ifndef M_PI
#    define M_PI 3.14159265358979323846
#endif

#define WEB_PADS       4
#define WEB_PAD_AXES   8
#define WEB_PAD_BUTTONS 17 /* "standard" gamepad mapping */

int                   joysticks_present = 0;
joystick_state_t      joystick_state[GAMEPORT_MAX][MAX_JOYSTICKS];
plat_joystick_state_t plat_joystick_state[MAX_PLAT_JOYSTICKS];

static volatile int pad_axes[WEB_PADS][WEB_PAD_AXES];
static volatile int pad_buttons[WEB_PADS];

/* axes: 8 values in -32767..32767; buttons: bit mask. */
EMSCRIPTEN_KEEPALIVE void
web_joystick_update(int pad, int a0, int a1, int a2, int a3, int a4, int a5, int a6, int a7, int buttons)
{
    if (pad < 0 || pad >= WEB_PADS)
        return;
    pad_axes[pad][0] = a0;
    pad_axes[pad][1] = a1;
    pad_axes[pad][2] = a2;
    pad_axes[pad][3] = a3;
    pad_axes[pad][4] = a4;
    pad_axes[pad][5] = a5;
    pad_axes[pad][6] = a6;
    pad_axes[pad][7] = a7;
    pad_buttons[pad] = buttons;
}

void
joystick_init(void)
{
    /* Gamepads are hot-plugged in browsers and only become visible after a
       button press, so always expose a fixed set of slots. */
    joysticks_present = WEB_PADS;
    for (int js = 0; js < WEB_PADS; js++) {
        snprintf(plat_joystick_state[js].name, sizeof(plat_joystick_state[js].name), "Gamepad %d", js + 1);
        plat_joystick_state[js].nr_axes    = WEB_PAD_AXES;
        plat_joystick_state[js].nr_buttons = WEB_PAD_BUTTONS;
        plat_joystick_state[js].nr_povs    = 0;
        for (int i = 0; i < WEB_PAD_AXES; i++) {
            snprintf(plat_joystick_state[js].axis[i].name, sizeof(plat_joystick_state[js].axis[i].name), "Axis %d", i);
            plat_joystick_state[js].axis[i].id = i;
        }
        for (int i = 0; i < WEB_PAD_BUTTONS; i++) {
            snprintf(plat_joystick_state[js].button[i].name, sizeof(plat_joystick_state[js].button[i].name), "Button %d", i);
            plat_joystick_state[js].button[i].id = i;
        }
    }
}

void
joystick_close(void)
{
}

static int
joystick_get_axis(int joystick_nr, int mapping)
{
    if (mapping & (POV_X | POV_Y))
        return 0;
    return plat_joystick_state[joystick_nr].a[plat_joystick_state[joystick_nr].axis[mapping].id];
}

void
joystick_process(uint8_t gp)
{
    if (!joystick_type[gp])
        return;

    for (int js = 0; js < WEB_PADS; js++) {
        for (int i = 0; i < WEB_PAD_AXES; i++)
            plat_joystick_state[js].a[i] = pad_axes[js][i];
        for (int i = 0; i < WEB_PAD_BUTTONS; i++)
            plat_joystick_state[js].b[i] = (pad_buttons[js] >> i) & 1;
    }

    for (int js = 0; js < joystick_get_max_joysticks(joystick_type[gp]); js++) {
        if (joystick_state[gp][js].plat_joystick_nr) {
            int joystick_nr = joystick_state[gp][js].plat_joystick_nr - 1;

            for (int axis_nr = 0; axis_nr < joystick_get_axis_count(joystick_type[gp]); axis_nr++)
                joystick_state[gp][js].axis[axis_nr] = joystick_get_axis(joystick_nr, joystick_state[gp][js].axis_mapping[axis_nr]);

            for (int button_nr = 0; button_nr < joystick_get_button_count(joystick_type[gp]); button_nr++)
                joystick_state[gp][js].button[button_nr] = plat_joystick_state[joystick_nr].b[joystick_state[gp][js].button_mapping[button_nr]];

            for (int pov_nr = 0; pov_nr < joystick_get_pov_count(joystick_type[gp]); pov_nr++) {
                int    x         = joystick_get_axis(joystick_nr, joystick_state[gp][js].pov_mapping[pov_nr][0]);
                int    y         = joystick_get_axis(joystick_nr, joystick_state[gp][js].pov_mapping[pov_nr][1]);
                double angle     = (atan2((double) y, (double) x) * 360.0) / (2 * M_PI);
                double magnitude = sqrt((double) x * (double) x + (double) y * (double) y);

                if (magnitude < 16384)
                    joystick_state[gp][js].pov[pov_nr] = -1;
                else
                    joystick_state[gp][js].pov[pov_nr] = ((int) angle + 90 + 360) % 360;
            }
        } else {
            for (int axis_nr = 0; axis_nr < joystick_get_axis_count(joystick_type[gp]); axis_nr++)
                joystick_state[gp][js].axis[axis_nr] = 0;

            for (int button_nr = 0; button_nr < joystick_get_button_count(joystick_type[gp]); button_nr++)
                joystick_state[gp][js].button[button_nr] = 0;

            for (int pov_nr = 0; pov_nr < joystick_get_pov_count(joystick_type[gp]); pov_nr++)
                joystick_state[gp][js].pov[pov_nr] = -1;
        }
    }
}
