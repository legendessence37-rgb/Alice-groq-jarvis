const GROQ_MODEL = "llama-3.3-70b-versatile";

const SYSTEM_PROMPT = 
  "Ты — Джарвис, вежливый голосовой ассистент. " +
  "Обращайся к пользователю уважительно (сэр). " +
  "Отвечай строго кратко: не более 1-2 предложений простым разговорным языком для голоса. " +
  "Никаких markdown, звездочек, кавычек, решеток, списков и рассуждений.";

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

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    return res.status(200).send("Alice Groq Webhook OK");
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
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
      buildResponse("Джарвис на связи, сэр. Все системы работают в штатном режиме. Чем могу помочь?", false, [])
    );
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(200).json(
      buildResponse("Сэр, в настройках Vercel отсутствует ключ GROQ_API_KEY.", false, history)
    );
  }

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.slice(-4).map(item => ({
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
        "Authorization": Bearer ${apiKey.trim()}
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: messages,
        temperature: 0.6,
        max_tokens: 120
      })
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      console.error(Groq error ${groqRes.status}:, errText);
      return res.status(200).json(
        buildResponse("Сэр, возникли временные неполадки со связью с сервером интеллекта.", false, history)
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
  } catch (error) {
    console.error("Handler error:", error);
    return res.status(200).json(
      buildResponse("Прошу прощения, сэр, заминка на линии. Повторите запрос.", false, history)
    );
  }
}
