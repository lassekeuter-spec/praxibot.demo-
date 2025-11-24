// api/chat.js

export default async function handler(req, res) {
  // Erlaubt nur POST-Anfragen
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Daten aus der Anfrage holen
    const { messages } = req.body || {};

    // Sicherheitscheck: messages muss ein Array sein
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "messages must be an array" });
    }

    // Anfrage an OpenAI senden
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // WICHTIG: API-Key kommt aus der Umgebungsvariable auf Vercel
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages, // hier geben wir einfach das weiter, was vom Frontend kam
      }),
    });

    const data = await openaiRes.json();

    // Wenn OpenAI einen Fehler zurückgibt, diesen weitergeben
    if (!openaiRes.ok) {
      return res.status(openaiRes.status).json(data);
    }

    // Alles ok → Antwort an den Browser schicken
    return res.status(200).json(data);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Server error" });
  }
}
