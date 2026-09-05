#ifndef HTML_TO_IMAGE_ILOGGER_H
#define HTML_TO_IMAGE_ILOGGER_H

// core/ilogger: satoru版を正として逐語移植。
// 正本: `satoru/src/cpp/core/ilogger.h`
// 変更点: ガード名、bridge include パスのみ。

#include <cstdarg>

#include "../bridge/bridge_types.h"

namespace satoru {

class ILogger {
   public:
    virtual ~ILogger() = default;
    virtual void log(LogLevel level, const char* message) = 0;
    virtual void logf(LogLevel level, const char* format, ...) = 0;
};

}  // namespace satoru

#endif  // HTML_TO_IMAGE_ILOGGER_H
