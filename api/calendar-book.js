// api/calendar-book.js
import crypto from "crypto";

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signJwtRS256({ header, payload, privateKey }) {
  const encHeader = base64url(JSON.stringify(header));
  const encPayload = base64url(JSON.stringify(payload));
  const toSign = `${encHeader}.${encPayload}`;

  const signature = crypto.createSign("RSA-SHA256").update(toSign).sign(privateKey);
  const encSig = signature
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${toSign}.${encSig}`;
}

async function getAccessToken() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON");

  const creds = JSON.parse(raw);
  const clientEmail = creds.client_email;
  let privateKey = creds.private_key;

  if (!clientEmail || !privateKey) throw new Error("Service account JSON incomplete");

  // Vercel escapt häufig Zeilenumbrüche
  privateKey = privateKey.replace(/\\n/g, "\n");

  const now = Math.floor(Date.now() / 1000);

  const jwt = signJwtRS256({
    header: { alg: "RS256", typ: "JWT" },
    payload: {
      iss: clientEmail,
      scope: "https://www.googleapis.com/auth/calendar",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 60 * 5, // 5 Minuten
    },
    privateKey,
  });

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const tokenData = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) {
    throw new Error(`Token error: ${tokenRes.status} ${JSON.stringify(tokenData)}`);
  }

  if (!tokenData.access_token) throw new Error("No access_token in token response");
  return tokenData.access_token;
}

async function freeBusy({ accessToken, calendarId, timeMin, timeMax }) {
  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin,
      timeMax,
      items: [{ id: calendarId }],
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`FreeBusy error: ${res.status} ${JSON.stringify(data)}`);

  const busy = data?.calendars?.[calendarId]?.busy ?? [];
  return Array.isArray(busy) ? busy : [];
}

async function insertEvent({ accessToken, calendarId, event }) {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(event),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Insert error: ${res.status} ${JSON.stringify(data)}`);

  return data;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const calendarId = process.env.GOOGLE_CALENDAR_ID;
    if (!calendarId) return res.status(500).json({ error: "Missing GOOGLE_CALENDAR_ID" });

    const { start, end, summary, description, attendeeEmail } = req.body || {};

    if (!start || !end || !summary) {
      return res.status(400).json({ error: "start, end und summary sind erforderlich" });
    }

    const accessToken = await getAccessToken();

    // 1) frei/belegt prüfen
    const busy = await freeBusy({
      accessToken,
      calendarId,
      timeMin: start,
      timeMax: end,
    });

    if (busy.length > 0) {
      return res.status(409).json({ error: "Zeitraum ist bereits belegt", busy });
    }

    // 2) Termin eintragen
    const created = await insertEvent({
      accessToken,
      calendarId,
      event: {
        summary,
        description: description || "",
        start: { dateTime: start, timeZone: "Europe/Berlin" },
        end: { dateTime: end, timeZone: "Europe/Berlin" },
        attendees: attendeeEmail ? [{ email: attendeeEmail }] : undefined,
      },
    });

    return res.status(200).json({
      ok: true,
      eventId: created.id,
      link: created.htmlLink,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Kalender-Fehler",
      detail: String(err?.message || err),
    });
  }
}
