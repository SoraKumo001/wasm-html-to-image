import { useEffect, useState } from "react";

// 出所: 本プロジェクトのエンコーダ自体で生成した極小JXL (8x8・79バイト) のbase64
const TINY_JXL_BASE64 =
  "/wpBwE4ATIAgAAwBbboSAAAVKqOMG7yc6/nyQ4fFtI3rDG21bWFJoojcPFPVOQg8JIlFkHkDBAASAP+cDwAAAAAAAABgnrStB0kliSFDMg==";

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function useJxlSupport(): boolean | null {
  const [support, setSupport] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (typeof createImageBitmap === "undefined") {
      setSupport(false);
      return;
    }
    try {
      const bytes = base64ToUint8Array(TINY_JXL_BASE64);
      const blob = new Blob([bytes.slice()], { type: "image/jxl" });
      createImageBitmap(blob).then(
        () => {
          if (!cancelled) setSupport(true);
        },
        () => {
          if (!cancelled) setSupport(false);
        },
      );
    } catch {
      if (!cancelled) setSupport(false);
    }
    return () => {
      cancelled = true;
    };
  }, []);

  return support;
}

export default useJxlSupport;
