type SentryEvent = {
  event_id: string
  timestamp: string
  platform: string
  level: string
  message: string
  environment?: string
  tags?: Record<string, string>
  extra?: Record<string, unknown>
}

export function createSentryEventId() {
  return crypto.randomUUID().replaceAll("-", "")
}

export async function captureSentryEvent(dsn: string, event: SentryEvent) {
  const parsed = parseSentryDsn(dsn)
  const envelope = [
    JSON.stringify({
      dsn,
      event_id: event.event_id,
      sent_at: new Date().toISOString(),
    }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n")

  const response = await fetch(parsed.envelopeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-sentry-envelope",
    },
    body: envelope,
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`Sentry ingest rejected event with HTTP ${response.status}: ${body.slice(0, 500)}`)
  }

  return {
    eventId: event.event_id,
    status: response.status,
  }
}

function parseSentryDsn(dsn: string) {
  const url = new URL(dsn)
  const projectId = url.pathname.split("/").filter(Boolean).at(-1)

  if (!projectId) {
    throw new Error("Sentry DSN is missing a project id path segment")
  }

  return {
    envelopeUrl: `${url.origin}/api/${projectId}/envelope/`,
  }
}
