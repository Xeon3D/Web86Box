/*
 * Web86Box - host networking.
 *
 * Browsers cannot open raw sockets and libslirp is not available, so the
 * SLiRP driver reports itself as unavailable; 86Box then falls back to the
 * null driver. (A WebSocket-relay backend can slot in here later.)
 */
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include <86box/86box.h>
#include <86box/device.h>
#include <86box/thread.h>
#include <86box/timer.h>
#include <86box/network.h>
#include <86box/plat_unused.h>

static void
net_web_in_available(UNUSED(void *priv))
{
}

static void *
net_web_init(UNUSED(const netcard_t *card), UNUSED(const uint8_t *mac_addr), UNUSED(void *priv), char *netdrv_errbuf)
{
    if (netdrv_errbuf)
        strcpy(netdrv_errbuf, "SLiRP networking is not available in the browser yet.");
    return NULL;
}

static void
net_web_close(UNUSED(void *priv))
{
}

const netdrv_t net_slirp_drv = {
    .notify_in = &net_web_in_available,
    .init      = &net_web_init,
    .close     = &net_web_close,
    .priv      = NULL
};

/* Normally defined by net_slirp.c; network.c resets it per hard reset. */
int slirp_card_num = 2;
