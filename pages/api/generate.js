export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests allowed" });
  }

  const { prompt, history } = req.body;

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "Missing OpenAI API key" });
  }

  try {
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4-turbo",
        messages: [
          {
            role: "system",
            content:
              "You are a code generator. Respond with multiple HTML files formatted like this:\n\n#### index.html\n```html\n...code...\n```\n\nOnly return HTML or JS or CSS formatted like above.",
          },
          ...history,
          { role: "user", content: prompt },
        ],
        temperature: 0.5,
      }),
    });

    const data = await openaiRes.json();
    const message = data.choices?.[0]?.message?.content;

    if (!message) {
      return res.status(500).json({ error: "Invalid response from OpenAI", full: data });
    }

    res.status(200).json({ message });
  } catch (error) {
    console.error("❌ Error communicating with OpenAI:", error);
    res.status(500).json({ error: "OpenAI request failed", details: error.message });
  }
}
