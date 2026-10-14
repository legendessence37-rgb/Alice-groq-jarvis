const GROQ_MODEL = "llama-3.3-70b-versatile";

const SYSTEM_PROMPT = 
  "Ты — голосовой ассистент Джарвис. Отвечай вежливо, называй пользователя 'сэр'. " +
  "Отвечай строго кратко: 1-2 предложения простым языком без markdown, списков и звездочек.";

function reply(res, text, history = []) {
  return res.status(200).json({
    version: "1.0",
    response: {
      text: String(text || "Слушаю вас, сэр.").slice(0, 1000),
      end_session: false
    },
    session_state: { history }
  });
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(200).send("OK");
    }

    const body = req.body || {};
    const request = body.request || {};
    const session = body.session || {};
    const state = body.state || {};

    const userText = (request.original_utterance  request.command  "").trim();
    const history = Array.isArray(state?.session?.history) ? state.session.history : [];

    // При открытии навыка или пустом вводе
    if (session.new || !userText) {
      return reply(res, "Джарвис на связи, сэр. Чем могу помочь?", []);
    }

    const apiKey = (process.env.GROQ_API_KEY || "").trim();
    if (!apiKey) {
      return reply(res, "Сэр, в настройках Vercel не указан ключ GROQ_API_KEY.", history);
    }

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history.slice(-4).map(h => ({
        role: h.role === "assistant" ? "assistant" : "user",
        content: String(h.text || "").slice(0, 300)
      })),
      { role: "user", content: userText }
    ];

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": Bearer ${apiKey}
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: messages,
        temperature: 0.6,
        max_tokens: 100
      })
    });

    if (!groqRes.ok) {
      const err = await groqRes.text();
      console.error("Groq error:", err);
      return reply(res, "Сэр, произошла ошибка на стороне нейросети.", history);
    }

    const data = await groqRes.json();
    const answer = data.choices?.[0]?.message?.content?.trim() || "Слушаю вас, сэр.";

    const nextHistory = [
      ...history,
      { role: "user", text: userText },
      { role: "assistant", text: answer }
    ].slice(-4);

    return reply(res, answer, nextHistory);
  } catch (err) {
    console.error("Crash error:", err);
    return reply(res, "Прошу прощения, сэр, произошла непредвиденная ошибка.", []);
  }
}
