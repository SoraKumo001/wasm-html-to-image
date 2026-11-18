export interface CDPRequest {
  id: number;
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
}

export interface CDPError {
  code: number;
  message: string;
}

export interface CDPResponse {
  id: number;
  result?: unknown;
  error?: CDPError;
  sessionId?: string;
}

export interface CDPEvent {
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
}

export interface ConnectionTransport {
  send(message: string): void;
  close(): void;
  onmessage?: (message: string) => void;
  onclose?: () => void;
}
