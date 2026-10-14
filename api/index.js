const GROQ_MODEL = "llama-3.3-70b-versatile";

const SYSTEM_PROMPT = 
  "Ты — Джарвис, вежливый голосовой ассистент. " +
  "Обращайся к пользователю уважительно (сэр). " +
  "Отвечай строго кратко: не более 1-2 предложений разговорным языком для голоса. " +
  "Не используй Markdown, звездочки, решетки, списки и внутренние рассуждения.";

function buildResponse(text, endSession = false, history = []) {
  return {
    version: "1.0",
    response: {
      text: String(text || "").trim().slice(0, 1000),
      end_session: endSession
    },
    session_state: { history }
  };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(200).send("Alice Groq OK");
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = {};
    }
  }
  body = body || {};

  const request = body.request || {};
  const session = body.session || {};
  const state = body.state || {};

  const isNew = Boolean(session.new);
  const userText = (request.original_utterance  request.command  "").trim();
  const history = Array.isArray(state?.session?.history) ? state.session.history : [];

  if (isNew || !userText) {
    return res.status(200).json(
      buildResponse("Джарвис на связи, сэр. Все системы работают штатно. Чем могу помочь?", false, [])
    );
  }

  const apiKey = (process.env.GROQ_API_KEY || "").trim();
  if (!apiKey) {
    return res.status(200).json(
      buildResponse("Сэр, не обнаружен ключ GROQ_API_KEY в настройках Vercel.", false, history)
    );
  }

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.slice(-4).map((item) => ({
      role: item.role === "assistant" ? "assistant" : "user",
      content: String(item.text || "").slice(0, 300)
    })),
    { role: "user", content: userText }
  ];

  try {
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
        max_tokens: 120
      })
    });

    if (!groqRes.ok) {
      return res.status(200).json(
        buildResponse("Сэр, связь с сервером интеллекта временно нестабильна.", false, history)
      );
    }

    const data = await groqRes.json();
    const reply = data.choices?.[0]?.message?.content?.trim() || "Слушаю вас, сэр.";

    const nextHistory = [
      ...history,
      { role: "user", text: userText },
      { role: "assistant", text: reply }
    ].slice(-4);

    return res.status(200).json(buildResponse(reply, false, nextHistory));
  } catch (err) {
    return res.status(200).json(
      buildResponse("Прошу прощения, сэр, заминка на линии. Повторите запрос.", false, history)
    );
  }
};
