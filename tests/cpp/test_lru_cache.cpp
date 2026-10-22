// tests/cpp/test_lru_cache.cpp — common/lru_cache.h のホスト単体テスト
// 方式: test_string_utils.cpp と同じ最小ランナー (標準ライブラリのみ・ctest 登録)。

#include <cstdio>
#include <string>

#include "common/lru_cache.h"

namespace {

int g_fail = 0;

void check(bool ok, const char* name) {
    std::printf("%s %s\n", ok ? "PASS" : "FAIL", name);
    if (!ok) ++g_fail;
}

using Cache = html_to_image::LruCache<std::string, int>;

void test_evicts_least_recently_used() {
    Cache c(2);
    c.put("a", 1);
    c.put("b", 2);
    c.put("c", 3);  // "a" is the oldest
    check(!c.exists("a"), "evicts the oldest entry");
    check(c.exists("b") && c.exists("c"), "keeps the newer entries");
    check(c.size() == 2, "size stays at capacity");
}

void test_get_refreshes_recency() {
    Cache c(2);
    c.put("a", 1);
    c.put("b", 2);
    int* a = c.get("a");  // "b" becomes the oldest
    check(a && *a == 1, "get returns the stored value");
    c.put("c", 3);
    check(c.exists("a") && !c.exists("b"), "get protects an entry from eviction");
}

}  // namespace

int main() {
    test_evicts_least_recently_used();
    test_get_refreshes_recency();
    std::printf("%s\n", g_fail == 0 ? "ALL PASS" : "SOME FAILED");
    return g_fail == 0 ? 0 : 1;
}
