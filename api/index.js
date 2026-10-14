import Groq from 'groq-sdk';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export default async function handler(req, res) {
  // Обработка только POST-запросов от Яндекс Диалогов
  if (req.method !== 'POST') {
    return res.status(200).json({ status: 'ok', message: 'Webhook is active' });
  }

  try {
    const { request, session, version } = req.body || {};

    // Проверяем входящую фразу пользователя (ИСПРАВЛЕНА СТРОКА НИЖЕ)
    const userText = request?.command  request?.original_utterance  '';

    // Приветствие при первом запуске навыка
    if (session?.new && !userText) {
      return res.status(200).json({
        version: version || '1.0',
        session: session || {},
        response: {
          text: 'Здравствуйте! Я ваш голосовой помощник Джарвис на базе нейросети. Чем могу помочь?',
          end_session: false,
        },
      });
    }

    // Если запрос пустой
    if (!userText.trim()) {
      return res.status(200).json({
        version: version || '1.0',
        session: session || {},
        response: {
          text: 'Слушаю вас, задайте вопрос.',
          end_session: false,
        },
      });
    }

    // Запрос к Groq API
    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: 'Ты — Джарвис, умный и вежливый голосовой ассистент. Отвечай кратко, емко и по делу на русском языке, так как ответ будет озвучен голосом.',
        },
        {
          role: 'user',
          content: userText,
        },
      ],
      model: 'llama-3.3-70b-versatile',
    });

    let answer = completion.choices[0]?.message?.content || 'Не удалось получить ответ от модели.';

    // Алиса ограничивает длину одного ответа максимум в 1024 символа
    if (answer.length > 1000) {
      answer = answer.slice(0, 997) + '...';
    }

    // Возвращаем ответ в формате Яндекс Диалогов
    return res.status(200).json({
      version: version || '1.0',
      session: session || {},
      response: {
        text: answer,
        end_session: false,
      },
    });
  } catch (error) {
    console.error('Ошибка обработки запроса:', error);

    return res.status(200).json({
      version: req.body?.version || '1.0',
      session: req.body?.session || {},
      response: {
        text: 'Произошла ошибка при обращении к нейросети. Пожалуйста, попробуйте еще раз позже.',
        end_session: false,
      },
    });
  }
}
