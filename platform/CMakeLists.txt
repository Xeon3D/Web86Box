#
# Web86Box - web (Emscripten) platform layer for 86Box.
#
# Included from 86Box's src/CMakeLists.txt when building with Emscripten
# and WEB86BOX_PLATFORM_DIR points here. It provides the `plat` and `ui`
# object libraries that the 86Box target links against.
#

set(UNIX_DIR ${CMAKE_SOURCE_DIR}/src/unix)

add_library(plat OBJECT
    web_main.c
    web_plat.c
    web_fs.c
    web_audio.c
    web_net.c
    web_joystick.c
    ${UNIX_DIR}/sdl_cdrom.c
    ${UNIX_DIR}/dummy_cdrom_ioctl.c
    ${UNIX_DIR}/dummy_floppy_ioctl.c
    ${UNIX_DIR}/unix_netsocket.c
    ${UNIX_DIR}/unix_dynld.c
)

add_library(ui OBJECT
    web_video.c
    web_ui.c
    web_catalog.c
)

target_compile_definitions(plat PUBLIC _FILE_OFFSET_BITS=64)

set(WEB86BOX_LINK_FLAGS
    -pthread
    -sWASMFS=1
    -sPROXY_TO_PTHREAD=1
    -sALLOW_MEMORY_GROWTH=1
    -sINITIAL_MEMORY=256MB
    -sMAXIMUM_MEMORY=4GB
    -sSTACK_SIZE=4MB
    -sDEFAULT_PTHREAD_STACK_SIZE=2MB
    -sPTHREAD_POOL_SIZE=8
    -sMODULARIZE=1
    -sEXPORT_ES6=1
    -sEXPORT_NAME=create86Box
    -sENVIRONMENT=web,worker
    -sEXIT_RUNTIME=0
    -sFORCE_FILESYSTEM=1
    -sSUPPORT_LONGJMP=wasm
    -sEXPORTED_RUNTIME_METHODS=ccall,cwrap,UTF8ToString,stringToUTF8,lengthBytesUTF8,HEAPU8,HEAP32,HEAPU32,HEAPF32,wasmMemory
    -sEXPORTED_FUNCTIONS=_main,_malloc,_free,_web_command,_web_key,_web_keyboard_all_up,_web_mouse_move,_web_mouse_abs,_web_mouse_buttons,_web_mouse_wheel,_web_get_shared,_web_msgbox_reply,_web_joystick_update
    --pre-js ${CMAKE_CURRENT_SOURCE_DIR}/web_pre.js
)
target_link_options(86Box PRIVATE ${WEB86BOX_LINK_FLAGS})
set_target_properties(86Box PROPERTIES OUTPUT_NAME "86Box" SUFFIX ".mjs")
