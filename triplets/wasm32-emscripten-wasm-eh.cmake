set(VCPKG_ENV_PASSTHROUGH_UNTRACKED EMSCRIPTEN_ROOT EMSDK PATH)

set(VCPKG_TARGET_ARCHITECTURE wasm32)
set(VCPKG_CRT_LINKAGE dynamic)
set(VCPKG_LIBRARY_LINKAGE static)
set(VCPKG_CMAKE_SYSTEM_NAME Emscripten)

if(NOT DEFINED ENV{EMSCRIPTEN_ROOT})
   if(NOT DEFINED ENV{EMSDK})
      set(EMSCRIPTEN_ROOT "C:/emsdk/upstream/emscripten")
   else()
      set(EMSCRIPTEN_ROOT "$ENV{EMSDK}/upstream/emscripten")
   endif()
else()
   set(EMSCRIPTEN_ROOT "$ENV{EMSCRIPTEN_ROOT}")
endif()

# Emscripten.cmake を包み、例外/longjmp フラグを CMAKE_*_FLAGS_INIT へ注入する。
# (VCPKG_C_FLAGS は Emscripten の chainload では各ポートに適用されないため。)
set(VCPKG_CHAINLOAD_TOOLCHAIN_FILE "${CMAKE_CURRENT_LIST_DIR}/emscripten-wasm-eh-toolchain.cmake")

# NOTE: satoru版に統一。image-opt版との差分は末尾 -mbulk-memory の有無のみであり、こちら(あり)を正とする。
set(COMMON_FLAGS "-fwasm-exceptions -sSUPPORT_LONGJMP=wasm -g0 -O3 -msimd128 -flto=thin -mbulk-memory")

set(VCPKG_C_FLAGS "${COMMON_FLAGS}")
set(VCPKG_CXX_FLAGS "${COMMON_FLAGS}")
set(VCPKG_C_FLAGS_DEBUG "${COMMON_FLAGS}")
set(VCPKG_CXX_FLAGS_DEBUG "${COMMON_FLAGS}")
set(VCPKG_C_FLAGS_RELEASE "${COMMON_FLAGS}")
set(VCPKG_CXX_FLAGS_RELEASE "${COMMON_FLAGS}")
