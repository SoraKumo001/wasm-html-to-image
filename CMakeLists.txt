cmake_minimum_required(VERSION 3.14)
set(CMAKE_WARN_DEPRECATED OFF CACHE BOOL "" FORCE)


# --- Toolchain setup (satoru正) ---
set(CMAKE_TOOLCHAIN_FILE "$ENV{VCPKG_ROOT}/scripts/buildsystems/vcpkg.cmake" CACHE STRING "")
set(VCPKG_TARGET_TRIPLET "wasm32-emscripten-wasm-eh" CACHE STRING "")
set(VCPKG_OVERLAY_TRIPLETS "${CMAKE_CURRENT_SOURCE_DIR}/triplets" CACHE STRING "")
set(VCPKG_CHAINLOAD_TOOLCHAIN_FILE "$ENV{EMSDK}/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake" CACHE STRING "")

project(html_to_image_wasm)
set(CMAKE_CXX_STANDARD 20)

# --- Unified options ---
# WASM_EXPORT_NAME: JS factory name. satoru='createSatoruModule' / image-opt='createImageConverterModule'
#  -> unified default 'createHtmlToImageModule' (override with -DWASM_EXPORT_NAME=...).
option(WASM_EXPORT_NAME "EMSCRIPTEN EXPORT_NAME" OFF) # handled below (string option emulation)
if(NOT DEFINED WASM_EXPORT_NAME OR WASM_EXPORT_NAME STREQUAL "OFF")
    set(WASM_EXPORT_NAME "createHtmlToImageModule")
endif()

# AVIF backend: AOM既定（encode対応。DAV1Dに戻す場合は -DWASM_AVIF_BACKEND=DAV1D）。
# satoru=DAV1D(SYSTEM)+AVIF_ENABLE_WASM=OFF / image-opt=AOM(SYSTEM)+AVIF_ENABLE_WASM=ON
set(WASM_AVIF_BACKEND "AOM" CACHE STRING "AVIF decoder backend: AOM (default) or DAV1D (decode-only)")

# Text shaping: ON既定 (satoru=freetype/harfbuzz/skshaper有効 / image-opt=無効だった差分をsatoru側に統一)
option(WASM_ENABLE_TEXT_SHAPING "Enable freetype+harfbuzz+skshaper" ON)
# PDF: ON (satoru=SK_SUPPORT_PDF=1 / image-opt=0 だった差分をsatoru側に統一)
option(WASM_ENABLE_PDF "Enable Skia PDF document support" ON)
# SKSL: OFF既定 (image-optのみsrc/sksl+SkRuntimeBlenderを取り込んでいた分。必要時のみON)
option(WASM_ENABLE_SKSL "Enable Skia SkSL sources" OFF)
# JXL: ON既定 (libjxl FetchContentで取得。JPEG XL encode/decode用)
option(WASM_ENABLE_JXL "Enable JPEG XL" ON)

# --- Enable ccache ---
find_program(CCACHE_PROGRAM ccache)
if(CCACHE_PROGRAM)
    set(CMAKE_C_COMPILER_LAUNCHER "${CCACHE_PROGRAM}")
    set(CMAKE_CXX_COMPILER_LAUNCHER "${CCACHE_PROGRAM}")
    message(STATUS "ccache enabled")
endif()

# --- Directories ---
set(LIBS_DIR "${CMAKE_CURRENT_SOURCE_DIR}/src/cpp/libs")
set(LITEHTML_DIR "${LIBS_DIR}/litehtml")
set(SKIA_CONFIG_DIR "${LIBS_DIR}/skia")

include(FetchContent)

# --- Skia (FetchContent main維持: 両リポ共通) ---
FetchContent_Declare(
  skia
  GIT_REPOSITORY https://github.com/google/skia.git
  GIT_TAG        main
  GIT_SHALLOW    TRUE
)
FetchContent_MakeAvailable(skia)

# --- AVIF / codec backends ---
set(VCPKG_INSTALLED_DIR "${CMAKE_BINARY_DIR}/vcpkg_installed/wasm32-emscripten-wasm-eh")
link_directories("${VCPKG_INSTALLED_DIR}/lib")

if(NOT TARGET dav1d::dav1d)
    add_library(dav1d::dav1d STATIC IMPORTED GLOBAL)
    set_target_properties(dav1d::dav1d PROPERTIES
        IMPORTED_LOCATION "${VCPKG_INSTALLED_DIR}/lib/libdav1d.a"
        INTERFACE_INCLUDE_DIRECTORIES "${VCPKG_INSTALLED_DIR}/include"
    )
endif()

find_package(ZLIB REQUIRED)

if(WASM_AVIF_BACKEND STREQUAL "AOM")
    # image-opt派生: libaom FetchContent (OPT-INのみ。既定DAV1Dでは取得しない)
    find_package(Perl REQUIRED)
    set(PERL_EXECUTABLE ${PERL_EXECUTABLE} CACHE FILEPATH "" FORCE)
    set(AOM_TARGET_CPU "generic" CACHE STRING "" FORCE)
    set(ENABLE_DOCS OFF CACHE BOOL "" FORCE)
    set(ENABLE_TESTS OFF CACHE BOOL "" FORCE)
    set(ENABLE_EXAMPLES OFF CACHE BOOL "" FORCE)
    set(ENABLE_TOOLS OFF CACHE BOOL "" FORCE)
    set(CONFIG_RUNTIME_CPU_DETECT 0 CACHE BOOL "" FORCE)
    set(CONFIG_MULTITHREAD 0 CACHE BOOL "" FORCE)
    set(CONFIG_WEBM_IO 0 CACHE BOOL "" FORCE)
    FetchContent_Declare(
      libaom
      GIT_REPOSITORY https://aomedia.googlesource.com/aom
      GIT_TAG        v3.11.0
      GIT_SHALLOW    TRUE
    )
    FetchContent_GetProperties(libaom)
    if(NOT libaom_POPULATED)
        FetchContent_Populate(libaom)
        set(OLD_CMAKE_C_FLAGS ${CMAKE_C_FLAGS})
        set(OLD_CMAKE_CXX_FLAGS ${CMAKE_CXX_FLAGS})
        set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -w")
        set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -w")
        add_subdirectory(${libaom_SOURCE_DIR} ${libaom_BINARY_DIR} EXCLUDE_FROM_ALL)
        set(CMAKE_C_FLAGS ${OLD_CMAKE_C_FLAGS})
        set(CMAKE_CXX_FLAGS ${OLD_CMAKE_CXX_FLAGS})
    endif()
    set(AVIF_CODEC_AOM SYSTEM CACHE STRING "" FORCE)
    set(AVIF_CODEC_AOM_DECODE ON CACHE BOOL "" FORCE)
    set(AVIF_CODEC_AOM_ENCODE ON CACHE BOOL "" FORCE)
    set(AVIF_ENABLE_WASM ON CACHE BOOL "" FORCE)
else()
    # satoru派生・既定: DAV1D
    set(AVIF_CODEC_DAV1D SYSTEM CACHE STRING "" FORCE)
    set(AVIF_ENABLE_WASM OFF CACHE BOOL "" FORCE)
endif()
set(AVIF_LIBYUV OFF CACHE BOOL "" FORCE)
set(AVIF_BUILD_APPS OFF CACHE BOOL "" FORCE)
set(AVIF_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE) # Force static for libavif

FetchContent_Declare(
  libavif
  GIT_REPOSITORY https://github.com/AOMediaCodec/libavif.git
  GIT_TAG        v1.1.1
)

set(CMAKE_SKIP_INSTALL_RULES ON)
set(OLD_CMAKE_C_FLAGS ${CMAKE_C_FLAGS})
set(OLD_CMAKE_CXX_FLAGS ${CMAKE_CXX_FLAGS})
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -w")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -w")
FetchContent_MakeAvailable(libavif)
set(CMAKE_C_FLAGS ${OLD_CMAKE_C_FLAGS})
set(CMAKE_CXX_FLAGS ${OLD_CMAKE_CXX_FLAGS})
set(CMAKE_SKIP_INSTALL_RULES OFF)

if(WASM_AVIF_BACKEND STREQUAL "AOM" AND TARGET avif_obj)
    target_include_directories(avif_obj PRIVATE
        ${libaom_SOURCE_DIR}
        ${libaom_BINARY_DIR}
        ${libaom_SOURCE_DIR}/aom
    )
endif()

# --- JXL (libjxl FetchContent) ---
if(WASM_ENABLE_JXL)
    set(BUILD_TESTING OFF CACHE BOOL "" FORCE)
    set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
    set(JPEGXL_ENABLE_TOOLS OFF CACHE BOOL "" FORCE)
    set(JPEGXL_ENABLE_BENCHMARK OFF CACHE BOOL "" FORCE)
    set(JPEGXL_ENABLE_EXAMPLES OFF CACHE BOOL "" FORCE)
    set(JPEGXL_ENABLE_MANPAGES OFF CACHE BOOL "" FORCE)
    set(JPEGXL_ENABLE_DOXYGEN OFF CACHE BOOL "" FORCE)
    set(JPEGXL_ENABLE_PLUGINS OFF CACHE BOOL "" FORCE)
    set(JPEGXL_ENABLE_VIEWERS OFF CACHE BOOL "" FORCE)
    set(JPEGXL_ENABLE_DEVTOOLS OFF CACHE BOOL "" FORCE)
    set(JPEGXL_ENABLE_JNI OFF CACHE BOOL "" FORCE)
    set(JPEGXL_ENABLE_FUZZERS OFF CACHE BOOL "" FORCE)
    set(JPEGXL_ENABLE_SJPEG OFF CACHE BOOL "" FORCE)
    set(JPEGXL_ENABLE_OPENEXR OFF CACHE BOOL "" FORCE)
    set(JPEGXL_ENABLE_TRANSCODE_JPEG OFF CACHE BOOL "" FORCE)
    set(JPEGXL_ENABLE_BOXES OFF CACHE BOOL "" FORCE)
    set(JPEGXL_ENABLE_WASM_THREADS OFF CACHE BOOL "" FORCE)
    set(JPEGXL_BUNDLE_LIBPNG OFF CACHE BOOL "" FORCE)
    set(JPEGXL_ENABLE_LTO OFF CACHE BOOL "" FORCE)
    FetchContent_Declare(
        libjxl
        GIT_REPOSITORY https://github.com/libjxl/libjxl.git
        GIT_TAG        v0.11.1
        GIT_SHALLOW    TRUE
        GIT_SUBMODULES_RECURSE TRUE
    )
    set(CMAKE_SKIP_INSTALL_RULES ON)
    FetchContent_GetProperties(libjxl)
    if(NOT libjxl_POPULATED)
        FetchContent_Populate(libjxl)
        set(OLD_CMAKE_C_FLAGS ${CMAKE_C_FLAGS})
        set(OLD_CMAKE_CXX_FLAGS ${CMAKE_CXX_FLAGS})
        set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -w")
        set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -w")
        add_subdirectory(${libjxl_SOURCE_DIR} ${libjxl_BINARY_DIR} EXCLUDE_FROM_ALL)
        set(CMAKE_C_FLAGS ${OLD_CMAKE_C_FLAGS})
        set(CMAKE_CXX_FLAGS ${OLD_CMAKE_CXX_FLAGS})
    endif()
    set(CMAKE_SKIP_INSTALL_RULES OFF)
endif()

# --- wuffs (両リポ共通) ---
set(WUFFS_RELEASE_DIR "${CMAKE_BINARY_DIR}/wuffs")
if(NOT EXISTS "${WUFFS_RELEASE_DIR}/wuffs-v0.3.c")
    file(MAKE_DIRECTORY "${WUFFS_RELEASE_DIR}")
    message(STATUS "Downloading wuffs-v0.3.c...")
    file(DOWNLOAD https://raw.githubusercontent.com/google/wuffs/main/release/c/wuffs-v0.3.c
         "${WUFFS_RELEASE_DIR}/wuffs-v0.3.c")
endif()

# --- Dependencies (satoru正 + image-opt分は内包済み) ---
# satoru: freetype/png/jpeg/webp/dav1d/zlib/gumbo/bzip2/brotli/expat/ctre/utf8proc/libunibreak/qpdf/harfbuzz
# image-opt: png/jpeg/webp/dav1d/expat/zlib/ctre (+aom FetchContent) -> すべて上記に含まれるため追加vcpkg依存なし
find_package(Freetype REQUIRED)
find_package(PNG REQUIRED)
find_package(JPEG REQUIRED)
find_package(WebP REQUIRED)
find_package(expat CONFIG REQUIRED)
find_package(unofficial-gumbo CONFIG REQUIRED)
find_package(unofficial-brotli CONFIG REQUIRED)
find_package(BZip2 REQUIRED)
find_package(ctre CONFIG REQUIRED)
find_package(utf8proc CONFIG REQUIRED)
find_package(libunibreak CONFIG REQUIRED)
find_package(harfbuzz REQUIRED)
find_package(qpdf CONFIG REQUIRED)

# Workaround for vcpkg harfbuzz path bug (satoru正)
if(TARGET harfbuzz)
    set_target_properties(harfbuzz PROPERTIES INTERFACE_INCLUDE_DIRECTORIES "${VCPKG_INSTALLED_DIR}/include/harfbuzz")
endif()

set(HTML_TO_IMAGE_LIBS
    Freetype::Freetype
    PNG::PNG
    WebP::webp
    WebP::webpdecoder
    WebP::webpdemux
    WebP::libwebpmux
    WebP::sharpyuv
    avif
    expat::expat
    unofficial::gumbo::gumbo
    unofficial::brotli::brotlidec
    unofficial::brotli::brotlienc
    unofficial::brotli::brotlicommon
    BZip2::BZip2
    ctre::ctre
    utf8proc::utf8proc
    libunibreak::libunibreak
    harfbuzz::harfbuzz
    qpdf::libqpdf
    JPEG::JPEG
    ZLIB::ZLIB
)
if(WASM_AVIF_BACKEND STREQUAL "DAV1D")
    list(APPEND HTML_TO_IMAGE_LIBS dav1d::dav1d)
else()
    list(APPEND HTML_TO_IMAGE_LIBS aom)
endif()

    # -mbulk-memoryありに統一 (image-optのCOMMONには無かった分をsatoru側に合わせる)
    set(COMMON_COMPILE_OPTIONS
        -Oz
        -g0
        -fexceptions
        -msimd128
        -flto=thin
        -mbulk-memory
    )
    set(COMMON_LINK_OPTIONS
        "--bind"
        "-O3"
        "-g0"
        -fexceptions
        -msimd128
        "-flto=thin"
        "-mbulk-memory"
        "-sWASM_BIGINT=1"
        "-sSUPPORT_LONGJMP=emscripten"
        "-sDISABLE_EXCEPTION_CATCHING=0"
        "-sDYNAMIC_EXECUTION=0"
        "-sASSERTIONS=0"
        "-sMODULARIZE=1"
        "-sEXPORT_ES6=1"
        "-sEXPORT_NAME='${WASM_EXPORT_NAME}'"
        "-sENVIRONMENT=web,worker"
        "-sFILESYSTEM=0"
        # Some Skia symbols (SkSL, RuntimeEffect) are undefined because we exclude their sources
        # to keep the binary size small. They are not used in our current rendering path.
        "-sERROR_ON_UNDEFINED_SYMBOLS=0"
        "-sWARN_ON_UNDEFINED_SYMBOLS=0"
        "-sALLOW_MEMORY_GROWTH=1"

    )

# --- COMMON/SINGLE差分メモ ---
# COMMON(通常): ENVIRONMENT=web,worker。SINGLE派生のみ -sSINGLE_FILE=1 を追加し
#   ENVIRONMENT=web,worker,node を許容する (image-opt single正。satoru singleはweb,workerのみだった差分)。
#   通常版とsingle版は同一OBJECTからリンクし、リンクオプションのみが異なる。

# --- Target: litehtml (satoruのみ。image-optには無し) ---
add_library(litehtml STATIC)
file(GLOB LITEHTML_SRC "${LITEHTML_DIR}/src/*.cpp")
target_sources(litehtml PRIVATE ${LITEHTML_SRC})
target_include_directories(litehtml PUBLIC
    "${LITEHTML_DIR}/include"
    "${LITEHTML_DIR}/include/litehtml"
)
target_link_libraries(litehtml PRIVATE unofficial::gumbo::gumbo)
target_compile_options(litehtml PRIVATE ${COMMON_COMPILE_OPTIONS} -w)


# --- Target: skia_lib ---
# satoru正をベースに統合:
#  - FreeType ports / skshaper+harfbuzz+skunicode: WASM_ENABLE_TEXT_SHAPING=ON既定で常時 (image-optは無し)
#  - src/pdf+pathops: satoru側あり/WASM_ENABLE_PDFで制御 (image-optはpdf無し・pathops有り)
#  - src/sksl+SkRuntimeBlender.cpp: WASM_ENABLE_SKSL=OFF既定で除外 (image-optのみ有り)
#  - SkDocument_PDF_None除外フィルタはsatoru正を維持
add_library(skia_lib STATIC)
file(GLOB SKIA_CORE_SRC
    "${skia_SOURCE_DIR}/src/core/*.cpp"
    "${skia_SOURCE_DIR}/src/base/*.cpp"
    "${skia_SOURCE_DIR}/src/utils/*.cpp"
    "${skia_SOURCE_DIR}/src/ports/SkOSFile_posix.cpp"
    "${skia_SOURCE_DIR}/src/ports/SkOSFile_stdio.cpp"
    "${skia_SOURCE_DIR}/src/ports/SkTime_Unix.cpp"
    "${skia_SOURCE_DIR}/src/ports/SkMemory_malloc.cpp"
    "${skia_SOURCE_DIR}/src/ports/SkDiscardableMemory_none.cpp"
    "${skia_SOURCE_DIR}/src/ports/SkFontMgr_custom.cpp"
    "${skia_SOURCE_DIR}/src/ports/SkFontMgr_custom_empty.cpp"
    "${skia_SOURCE_DIR}/src/ports/SkLog_stdio.cpp"
    "${skia_SOURCE_DIR}/src/ports/SkGlobalInitialization_default.cpp"
    "${skia_SOURCE_DIR}/src/image/*.cpp"
    "${skia_SOURCE_DIR}/src/shaders/*.cpp"
    "${skia_SOURCE_DIR}/src/shaders/gradients/*.cpp"
    "${skia_SOURCE_DIR}/src/effects/*.cpp"
    "${skia_SOURCE_DIR}/src/effects/imagefilters/*.cpp"
    "${skia_SOURCE_DIR}/src/effects/colorfilters/*.cpp"
    "${skia_SOURCE_DIR}/src/svg/*.cpp"
    "${skia_SOURCE_DIR}/src/xml/*.cpp"
    "${skia_SOURCE_DIR}/src/text/*.cpp"
    "${skia_SOURCE_DIR}/modules/skcms/skcms.cc"
    "${skia_SOURCE_DIR}/modules/skcms/src/skcms_TransformBaseline.cc"
    "${skia_SOURCE_DIR}/src/encode/SkEncoder.cpp"
    "${skia_SOURCE_DIR}/src/encode/SkPngEncoderImpl.cpp"
    "${skia_SOURCE_DIR}/src/encode/SkPngEncoderBase.cpp"
    "${skia_SOURCE_DIR}/src/encode/SkJpegEncoderImpl.cpp"
    "${skia_SOURCE_DIR}/src/encode/SkJPEGWriteUtility.cpp"
    "${skia_SOURCE_DIR}/src/encode/SkWebpEncoderImpl.cpp"
    "${skia_SOURCE_DIR}/src/encode/SkICC.cpp"
    "${skia_SOURCE_DIR}/src/codec/SkCodec.cpp"
    "${skia_SOURCE_DIR}/src/codec/SkCodecColorProfile.cpp"
    "${skia_SOURCE_DIR}/src/codec/SkCodecImageGenerator.cpp"
    "${skia_SOURCE_DIR}/src/codec/SkImageGenerator_FromEncoded.cpp"
    "${skia_SOURCE_DIR}/src/codec/SkEncodedInfo.cpp"
    "${skia_SOURCE_DIR}/src/codec/SkPngCodec.cpp"
    "${skia_SOURCE_DIR}/src/codec/SkPngCodecBase.cpp"
    "${skia_SOURCE_DIR}/src/codec/SkPngCompositeChunkReader.cpp"
    "${skia_SOURCE_DIR}/src/codec/SkExif.cpp"
    "${skia_SOURCE_DIR}/src/codec/SkTiffUtility.cpp"
    "${skia_SOURCE_DIR}/src/codec/SkGainmapInfo.cpp"
    "${skia_SOURCE_DIR}/src/utils/SkOTUtils.cpp"
    "${skia_SOURCE_DIR}/src/codec/SkBmpBaseCodec.cpp"
    "${skia_SOURCE_DIR}/src/codec/SkBmpCodec.cpp"
    "${skia_SOURCE_DIR}/src/codec/SkBmpMaskCodec.cpp"
    "${skia_SOURCE_DIR}/src/codec/SkBmpRLECodec.cpp"
    "${skia_SOURCE_DIR}/src/codec/SkBmpStandardCodec.cpp"
    "${skia_SOURCE_DIR}/src/codec/SkIcoCodec.cpp"
    "${skia_SOURCE_DIR}/src/codec/SkParseEncodedOrigin.cpp"
    "${skia_SOURCE_DIR}/src/codec/SkMaskSwizzler.cpp"
    "${skia_SOURCE_DIR}/src/codec/SkSwizzler.cpp"
    "${skia_SOURCE_DIR}/src/codec/SkSampler.cpp"
    "${skia_SOURCE_DIR}/src/codec/SkColorPalette.cpp"
    "${skia_SOURCE_DIR}/src/codec/SkColorTable.cpp"
    "${skia_SOURCE_DIR}/src/codec/SkPixmapUtils.cpp"
    "${skia_SOURCE_DIR}/src/codec/SkHdrMetadata.cpp"
    "${skia_SOURCE_DIR}/src/codec/SkWuffsCodec.cpp"
    "src/cpp/libs/skia/wuffs_implementation.cpp"
    "${skia_SOURCE_DIR}/src/codec/SkJpegCodec.cpp"
    "${skia_SOURCE_DIR}/src/codec/SkJpegDecoderMgr.cpp"
    "${skia_SOURCE_DIR}/src/codec/SkJpegMetadataDecoderImpl.cpp"
    "${skia_SOURCE_DIR}/src/codec/SkJpegMultiPicture.cpp"
    "${skia_SOURCE_DIR}/src/codec/SkJpegSegmentScan.cpp"
    "${skia_SOURCE_DIR}/src/codec/SkJpegSourceMgr.cpp"
    "${skia_SOURCE_DIR}/src/codec/SkJpegUtility.cpp"
    "${skia_SOURCE_DIR}/src/codec/SkJpegXmp.cpp"
    "${skia_SOURCE_DIR}/src/codec/SkWebpCodec.cpp"
    "${skia_SOURCE_DIR}/src/codec/SkAvifCodec.cpp"
    "${skia_SOURCE_DIR}/modules/svg/src/*.cpp"
    "${skia_SOURCE_DIR}/modules/skresources/src/*.cpp"
)
if(WASM_ENABLE_TEXT_SHAPING)
    file(GLOB SKIA_SHAPER_SRC
        "${skia_SOURCE_DIR}/src/ports/SkFontHost_FreeType.cpp"
        "${skia_SOURCE_DIR}/src/ports/SkFontHost_FreeType_common.cpp"
        "${skia_SOURCE_DIR}/modules/skshaper/src/SkShaper.cpp"
        "${skia_SOURCE_DIR}/modules/skshaper/src/SkShaper_primitive.cpp"
        "${skia_SOURCE_DIR}/modules/skshaper/src/SkShaper_harfbuzz.cpp"
        "${skia_SOURCE_DIR}/modules/skshaper/src/SkShaper_skunicode.cpp"
        "${skia_SOURCE_DIR}/modules/skshaper/src/SkShaper_factory.cpp"
        "${skia_SOURCE_DIR}/modules/skunicode/src/SkUnicode.cpp"
        "${skia_SOURCE_DIR}/modules/skunicode/src/SkUnicode_hardcoded.cpp"
    )
    list(APPEND SKIA_CORE_SRC ${SKIA_SHAPER_SRC})
endif()
if(WASM_ENABLE_PDF)
    file(GLOB SKIA_PDF_SRC
        "${skia_SOURCE_DIR}/src/pdf/*.cpp"
        "${skia_SOURCE_DIR}/src/pathops/*.cpp"
    )
    list(APPEND SKIA_CORE_SRC ${SKIA_PDF_SRC})
else()
    # PDF無効時もpathopsは残す (image-opt構成との互換)
    file(GLOB SKIA_PATHOPS_SRC "${skia_SOURCE_DIR}/src/pathops/*.cpp")
    list(APPEND SKIA_CORE_SRC ${SKIA_PATHOPS_SRC})
endif()
if(WASM_ENABLE_SKSL)
    # image-opt派生 (既定OFF)。ON時のみSkSL系を取り込む
    file(GLOB SKIA_SKSL_SRC
        "${skia_SOURCE_DIR}/src/core/SkRuntimeBlender.cpp"
        "${skia_SOURCE_DIR}/src/sksl/*.cpp"
        "${skia_SOURCE_DIR}/src/sksl/analysis/*.cpp"
        "${skia_SOURCE_DIR}/src/sksl/codegen/SkSLRasterPipelineBuilder.cpp"
        "${skia_SOURCE_DIR}/src/sksl/codegen/SkSLRasterPipelineCodeGenerator.cpp"
        "${skia_SOURCE_DIR}/src/sksl/ir/*.cpp"
        "${skia_SOURCE_DIR}/src/sksl/transform/*.cpp"
        "${skia_SOURCE_DIR}/src/sksl/tracing/*.cpp"
    )
    list(APPEND SKIA_CORE_SRC ${SKIA_SKSL_SRC})
endif()
list(FILTER SKIA_CORE_SRC EXCLUDE REGEX ".*_win.cpp|.*_mac.cpp|.*_linux.cpp|.*_android.cpp|.*_ios.cpp")
# NOTE: SkSemaphoreは除外しない (converter_encode等の実働パスが参照し、
# 欠落するとwasm実行時にAborted(missing function)で落ちる。POSIX sem実装のため
# emscripten下でも追加依存なしでリンク可)。SkThreadは引き続き除外。
list(FILTER SKIA_CORE_SRC EXCLUDE REGEX ".*SkGetExecutablePath.*|.*SkThread.*|.*SkRuntimeEffect.*|.*SkMesh.*|.*SkRuntimeBlender.*|.*SkSL.*|.*SkGPU.*|.*SkGpu.*|.*SkGraphite.*|.*SkDocument_PDF_None.cpp|.*src/gpu/.*|.*src/graphite/.*")
if(WASM_ENABLE_SKSL)
    # SKSL有効時はRuntimeBlender/SkSL除外フィルタを外す (上記で追加した分を復活)
    list(FILTER SKIA_CORE_SRC EXCLUDE REGEX ".*_win.cpp|.*_mac.cpp|.*_linux.cpp|.*_android.cpp|.*_ios.cpp")
endif()

target_sources(skia_lib PRIVATE ${SKIA_CORE_SRC})
target_include_directories(skia_lib PUBLIC
    "${SKIA_CONFIG_DIR}"
    "${skia_SOURCE_DIR}"
    "${WUFFS_RELEASE_DIR}"
    "${skia_SOURCE_DIR}/modules/svg/include"
    "${skia_SOURCE_DIR}/modules/skresources/include"
    "${skia_SOURCE_DIR}/modules/skshaper/include"
    "${skia_SOURCE_DIR}/modules/skunicode/include"
)
set(SKIA_UNIFIED_DEFS SK_USER_CONFIG_HEADER="SkUserConfig.h" SK_ENABLE_SVG SK_DISABLE_FILESYSTEM SKCMS_PORTABLE)
if(WASM_ENABLE_TEXT_SHAPING)
    list(APPEND SKIA_UNIFIED_DEFS SK_SHAPER_HARFBUZZ_AVAILABLE SK_SHAPER_UNICODE_AVAILABLE)
endif()
target_compile_definitions(skia_lib PUBLIC ${SKIA_UNIFIED_DEFS})
target_compile_options(skia_lib PRIVATE ${COMMON_COMPILE_OPTIONS} -w)
target_link_libraries(skia_lib PUBLIC ${HTML_TO_IMAGE_LIBS})


# --- Target: html_to_image_core (satoru_core + image_converter_core 統合予定) ---
# Phase2で satoru_core由来 (container_skia/renderers等) と image_converter_core由来
# (image_converter_context/thumbhash等) のOBJECTをここへ集約する。現時点ではmain.cppのみ。
add_library(html_to_image_core OBJECT)
target_sources(html_to_image_core PRIVATE
    src/cpp/main.cpp
    src/cpp/common/image_decoder.cpp
    src/cpp/common/svg_patch.cpp
    src/cpp/common/skia_encode.cpp
    src/cpp/common/skia_utils.cpp
    src/cpp/common/thumbhash.cpp
    src/cpp/core/satoru_context.cpp
    src/cpp/core/image_converter_context.cpp
    src/cpp/api/satoru_api.cpp
    src/cpp/api/converter_api.cpp
    src/cpp/api/unified_api.cpp
    src/cpp/api/satoru_bindings.cpp
    src/cpp/api/converter_bindings.cpp
    src/cpp/api/unified_bindings.cpp
    src/cpp/api/js_logger.cpp
    src/cpp/core/container_skia.cpp
    src/cpp/core/container_skia_helpers.cpp
    src/cpp/core/container_skia_filters.cpp
    src/cpp/core/container_skia_transforms.cpp
    src/cpp/core/container_skia_clip.cpp
    src/cpp/core/text_utils.cpp
    src/cpp/core/text/unicode_service.cpp
    src/cpp/core/text/text_layout.cpp
    src/cpp/core/text/text_renderer.cpp
    src/cpp/core/text/text_decoration_renderer.cpp
    src/cpp/core/text/tagging_context.cpp
    src/cpp/core/text/text_geometry.cpp
    src/cpp/core/litehtml_extensions.cpp
    src/cpp/core/el_svg.cpp
    src/cpp/core/resource_manager.cpp
    src/cpp/core/font_manager.cpp
    src/cpp/renderers/svg_renderer.cpp
    src/cpp/renderers/png_renderer.cpp
    src/cpp/renderers/webp_renderer.cpp
    src/cpp/renderers/pdf_renderer.cpp
    src/cpp/utils/logging.cpp
    src/cpp/utils/pdf_merger.cpp
    src/cpp/utils/skia_stubs.cpp
    src/cpp/utils/skunicode_satoru.cpp
)
target_include_directories(html_to_image_core PRIVATE
    "src/cpp"
    "${LITEHTML_DIR}/include"
    "${LITEHTML_DIR}/include/litehtml"
    "${LITEHTML_DIR}/src"
)
target_link_libraries(html_to_image_core PUBLIC litehtml skia_lib)
target_compile_options(html_to_image_core PRIVATE ${COMMON_COMPILE_OPTIONS})
target_compile_definitions(html_to_image_core PRIVATE SK_USER_CONFIG_HEADER="SkUserConfig.h")
if(WASM_ENABLE_JXL)
    target_compile_definitions(html_to_image_core PRIVATE JXL_ENABLED)
    # lib/jxl.cmake 公開ターゲット: `jxl` 優先、なければ `jxl_enc`
    # NOTE: OBJECT ライブラリのため $<TARGET_OBJECTS:...> 形式では最終リンクに伝播しない。
    # 実行ファイル側への PRIVATE リンクが必須（下記 Executables 参照）。ここは将来の直接リンクに備え PUBLIC。
    if(TARGET jxl)
        target_link_libraries(html_to_image_core PUBLIC jxl)
    elseif(TARGET jxl_enc)
        target_link_libraries(html_to_image_core PUBLIC jxl_enc)
    endif()
endif()

# --- Executables ---
add_executable(html_to_image $<TARGET_OBJECTS:html_to_image_core>)
target_link_libraries(html_to_image PRIVATE litehtml skia_lib)
if(WASM_ENABLE_JXL)
    if(TARGET jxl)
        target_link_libraries(html_to_image PRIVATE jxl)
    elseif(TARGET jxl_enc)
        target_link_libraries(html_to_image PRIVATE jxl_enc)
    endif()
endif()
target_link_options(html_to_image PRIVATE ${COMMON_LINK_OPTIONS})
set_target_properties(html_to_image PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/packages/html-to-image/dist"
    OUTPUT_NAME "html-to-image"
    SUFFIX ".js"
)

add_executable(html_to_image_single $<TARGET_OBJECTS:html_to_image_core>)
target_link_libraries(html_to_image_single PRIVATE litehtml skia_lib)
if(WASM_ENABLE_JXL)
    if(TARGET jxl)
        target_link_libraries(html_to_image_single PRIVATE jxl)
    elseif(TARGET jxl_enc)
        target_link_libraries(html_to_image_single PRIVATE jxl_enc)
    endif()
endif()
# SINGLE派生のみ +SINGLE_FILE と ENVIRONMENT=web,worker,node許容 (COMMON/SINGLE差分)
target_link_options(html_to_image_single PRIVATE ${COMMON_LINK_OPTIONS} "-sSINGLE_FILE=1" "-sENVIRONMENT=web,worker,node")
set_target_properties(html_to_image_single PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/packages/html-to-image/dist"
    OUTPUT_NAME "html-to-image-single"
    SUFFIX ".js"
)
