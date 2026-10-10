/*
 * Web86Box - tiny growable string builder with JSON helpers.
 */
#ifndef WEB86BOX_JSON_H
#define WEB86BOX_JSON_H

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct jbuf_t {
    char  *s;
    size_t len;
    size_t cap;
} jbuf_t;

static inline void
jb_reserve(jbuf_t *b, size_t extra)
{
    if (b->len + extra + 1 > b->cap) {
        size_t cap = b->cap ? b->cap : 256;
        while (cap < b->len + extra + 1)
            cap *= 2;
        b->s   = realloc(b->s, cap);
        b->cap = cap;
    }
}

static inline void
jb_raw(jbuf_t *b, const char *s)
{
    size_t n = strlen(s);
    jb_reserve(b, n);
    memcpy(b->s + b->len, s, n + 1);
    b->len += n;
}

static inline void
jb_printf(jbuf_t *b, const char *fmt, ...)
{
    va_list ap;
    va_start(ap, fmt);
    int n = vsnprintf(NULL, 0, fmt, ap);
    va_end(ap);
    if (n < 0)
        return;
    jb_reserve(b, (size_t) n);
    va_start(ap, fmt);
    vsnprintf(b->s + b->len, (size_t) n + 1, fmt, ap);
    va_end(ap);
    b->len += (size_t) n;
}

/* Append a JSON string literal (with quotes); NULL becomes null. */
static inline void
jb_str(jbuf_t *b, const char *s)
{
    if (s == NULL) {
        jb_raw(b, "null");
        return;
    }
    jb_reserve(b, strlen(s) * 6 + 2);
    char *o = b->s + b->len;
    *o++    = '"';
    for (const unsigned char *p = (const unsigned char *) s; *p; p++) {
        switch (*p) {
            case '"':  *o++ = '\\'; *o++ = '"'; break;
            case '\\': *o++ = '\\'; *o++ = '\\'; break;
            case '\n': *o++ = '\\'; *o++ = 'n'; break;
            case '\r': *o++ = '\\'; *o++ = 'r'; break;
            case '\t': *o++ = '\\'; *o++ = 't'; break;
            default:
                if (*p < 0x20)
                    o += sprintf(o, "\\u%04x", *p);
                else
                    *o++ = (char) *p;
                break;
        }
    }
    *o++   = '"';
    *o     = '\0';
    b->len = (size_t) (o - b->s);
}

/* "key": */
static inline void
jb_key(jbuf_t *b, const char *k)
{
    jb_str(b, k);
    jb_raw(b, ":");
}

/* Drop a trailing comma before closing a container. */
static inline void
jb_close(jbuf_t *b, char c)
{
    if (b->len && b->s[b->len - 1] == ',')
        b->len--;
    char t[2] = { c, 0 };
    jb_raw(b, t);
}

#endif
