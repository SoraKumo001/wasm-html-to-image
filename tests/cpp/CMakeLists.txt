# tests/cpp/CMakeLists.txt — ホスト単体テスト (P5)
#
# 方針: 外部依存を増やさない (gtest等のFetchContent/vcpkg追加なし)。
#   assert相当の自前CHECKを持つ単一cpp + ctest登録のみ。
# 使い方:
#   (a) 単独 (推奨・WASM設定と無関係): cmake -S tests/cpp -B build-host-tests && cmake --build build-host-tests && ctest --test-dir build-host-tests
#   (b) ルート経由: ホストconfigure時のみトップのガード付きブロックから add_subdirectory される
#       (EMSCRIPTEN/Emscripten時は登録されない = WASMビルド無影響)。
# 既存ターゲット・フラグ・ソースリストへの変更なし。

# 単独configure時のみ project 定義 (add_subdirectory 時は二重定義を避ける)
if(CMAKE_SOURCE_DIR STREQUAL CMAKE_CURRENT_SOURCE_DIR)
    cmake_minimum_required(VERSION 3.14)
    project(html_to_image_host_tests CXX)
    set(CMAKE_CXX_STANDARD 20)
    set(CMAKE_CXX_STANDARD_REQUIRED ON)
    include(CTest)
endif()

add_executable(test_string_utils test_string_utils.cpp)
# string_utils.h は標準ライブラリのみのため、src/cpp を -I にするだけでホストコンパイル可
target_include_directories(test_string_utils PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/../../src/cpp")
target_compile_features(test_string_utils PRIVATE cxx_std_20)

add_test(NAME string_utils COMMAND test_string_utils)
