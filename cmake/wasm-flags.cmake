# cmake/wasm-flags.cmake — wasm 共通コンパイル/リンクフラグ + SINGLE_FILE 差分
#
# P3a 分割前: CMakeLists.txt の COMMON_COMPILE_OPTIONS / COMMON_LINK_OPTIONS ブロック
# (および COMMON/SINGLE 差分メモ) を等価移動。値の変更なし。
#
# Provenance:
#  - -mbulk-memory ありに統一 (image-opt の COMMON には無かった分を satoru 側に合わせる)
#  - -Oz / -msimd128 / -flto=thin は wasm バイナリサイズ最適化の要。変更時は
#    triplets/wasm32-emscripten-wasm-eh.cmake の COMMON_FLAGS との整合を確認すること。

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
set(SINGLE_EXTRA_LINK_OPTIONS
    "-sSINGLE_FILE=1"
    "-sENVIRONMENT=web,worker,node"
)
