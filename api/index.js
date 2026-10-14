const GROQ_MODEL = "llama-3.3-70b-versatile";

const SYSTEM_PROMPT = 
  "Ты — Джарвис, вежливый, остроумный голосовой ассистент. " +
  "Обращайся к пользователю уважительно (сэр). " +
  "Отвечай строго кратко: не более 1-2 коротких предложений, разговорным языком для голоса. " +
  "Категорически запрещено использовать разметку Markdown, символы *, решётки, списки и внутренние рассуждения.";

function buildResponse(text, endSession = false, history = []) {
  return {
    version: "1.0",
    response: {
      text: text.slice(0, 1000),
      end_session: endSession
    },
    session_state: { history }
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("Alice Groq Webhook OK");
  }

  const { request, session, state } = req.body || {};
  const isNew = session?.new ?? false;
  const userText = (request?.original_utterance || "").trim();
  const history = Array.isArray(state?.session?.history) ? state.session.history : [];

  if (isNew || !userText) {
    return res.status(200).json(
      buildResponse("Джарвис на связи, сэр. Все системы функционируют штатно. Чем могу помочь?", false, [])
    );
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(200).json(
      buildResponse("Сэр, не обнаружен ключ GROQ_API_KEY в настройках Vercel.", false, history)
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
      throw new Error(Groq status ${groqRes.status});
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
    console.error("Groq error:", error);
    return res.status(200).json(
      buildResponse("Прошу прощения, сэр, небольшая задержка на линии. Повторите, пожалуйста.", false, history)
    );
  }
}
