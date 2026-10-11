# vcpkg chainload: Emscripten toolchain + ネイティブ wasm 例外 / wasm SjLj。
# triplets/wasm32-emscripten-wasm-eh.cmake から参照される。
# cmake/wasm-flags.cmake の WASM_EH_FLAGS と同じ値を保つこと。
if(DEFINED ENV{EMSCRIPTEN_ROOT})
  set(_emscripten_root "$ENV{EMSCRIPTEN_ROOT}")
elseif(DEFINED ENV{EMSDK})
  set(_emscripten_root "$ENV{EMSDK}/upstream/emscripten")
else()
  set(_emscripten_root "C:/emsdk/upstream/emscripten")
endif()

include("${_emscripten_root}/cmake/Modules/Platform/Emscripten.cmake")

set(_wasm_eh_flags "-fwasm-exceptions -sSUPPORT_LONGJMP=wasm")
string(APPEND CMAKE_C_FLAGS_INIT " ${_wasm_eh_flags}")
string(APPEND CMAKE_CXX_FLAGS_INIT " ${_wasm_eh_flags}")
