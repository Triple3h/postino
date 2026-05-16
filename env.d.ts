/// <reference types="vite/client" />

declare const chrome: {
  runtime?: {
    sendMessage?: (message: unknown, callback?: (response: unknown) => void) => void
    lastError?: { message?: string }
  }
}
