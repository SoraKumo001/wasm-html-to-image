#ifndef SATORU_UTILS_LOGGING_H
#define SATORU_UTILS_LOGGING_H

#include "../bridge/bridge_types.h"
#include "../core/ilogger.h"

// Legacy macros for backward compatibility.
// New code should use ILogger directly via SatoruContext::getLogger().
//
// P0 ログフォーマット規約 (TS packages/html-to-image/src/diagnostics.ts 集約想定):
//  - エラー/警告メッセージは "[CODE] human-readable detail" 形式とする。
//  - CODE は DiagnosticMessage.code に対応 (例: MAGIC_COLOR_PARSE_FAILED,
//    FONT_UNICODE_RANGE_PARSE_FAILED, COLLECT_RESOURCES_FAILED, JS_LOG_FORWARD_FAILED,
//    PDF_MERGE_FAILED)。TS 側 DIAGNOSTIC_CODES に将来追加する場合は UPPER_SNAKE とする。
//  - 正常系のメッセージ形式・レベル・ABI/bindings は変えない。新規 throw はしない。

#define SATORU_LOG_DEBUG(...)                                     \
    do {                                                          \
        auto* _logger = satoru_log_get_logger();                  \
        if (_logger) _logger->logf(LogLevel::Debug, __VA_ARGS__); \
    } while (0)

#define SATORU_LOG_INFO(...)                                     \
    do {                                                         \
        auto* _logger = satoru_log_get_logger();                 \
        if (_logger) _logger->logf(LogLevel::Info, __VA_ARGS__); \
    } while (0)

#define SATORU_LOG_WARN(...)                                        \
    do {                                                            \
        auto* _logger = satoru_log_get_logger();                    \
        if (_logger) _logger->logf(LogLevel::Warning, __VA_ARGS__); \
    } while (0)

#define SATORU_LOG_ERROR(...)                                     \
    do {                                                          \
        auto* _logger = satoru_log_get_logger();                  \
        if (_logger) _logger->logf(LogLevel::Error, __VA_ARGS__); \
    } while (0)

// Global logger access for legacy macros.
// In production, set via satoru_log_set_logger().
// In tests, set to NullLogger.
#ifdef __cplusplus
extern "C" {
#endif
satoru::ILogger* satoru_log_get_logger();
void satoru_log_set_logger(satoru::ILogger* logger);
#ifdef __cplusplus
}
#endif

#endif  // SATORU_UTILS_LOGGING_H
