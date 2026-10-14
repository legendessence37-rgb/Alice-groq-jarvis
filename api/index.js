import Groq from 'groq-sdk';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ status: 'ok', message: 'Webhook is active' });
  }

  try {
    const body = req.body ? req.body : {};
    const request = body.request ? body.request : {};
    const session = body.session ? body.session : {};
    const version = body.version ? body.version : '1.0';

    let userText = '';
    if (request.command) {
      userText = request.command;
    } else if (request.original_utterance) {
      userText = request.original_utterance;
    }

    if (session.new && !userText) {
      return res.status(200).json({
        version: version,
        session: session,
        response: {
          text: 'Здравствуйте! Я ваш голосовой помощник Джарвис. Чем могу помочь?',
          end_session: false,
        },
      });
    }

    if (!userText.trim()) {
      return res.status(200).json({
        version: version,
        session: session,
        response: {
          text: 'Слушаю вас, задайте вопрос.',
          end_session: false,
        },
      });
    }

    const groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });

    // 1. Запрашиваем у Groq список всех моделей, которые реально доступны вашему ключу
    const modelsList = await groq.models.list();
    const allModels = modelsList.data ? modelsList.data.map(function(m) { return m.id; }) : [];

    // 2. Отсеиваем голосовые и служебные модели (оставляем только чат-модели)
    const chatModels = allModels.filter(function(id) {
      const lower = id.toLowerCase();
      return !lower.includes('whisper') && !lower.includes('tts') && !lower.includes('guard') && !lower.includes('vision');
    });

    // 3. Выбираем лучшую из доступных
    const preferred = [
      'llama-3.1-8b-instant',
      'llama3-8b-8192',
      'llama3-70b-8192',
      'gemma2-9b-it',
      'mixtral-8x7b-32768'
    ];

    let selectedModel = chatModels[0] ? chatModels[0] : 'llama-3.1-8b-instant';
    for (let i = 0; i < preferred.length; i++) {
      if (chatModels.includes(preferred[i])) {
        selectedModel = preferred[i];
        break;
      }
    }

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
      model: selectedModel,
    });

    let answer = 'Не удалось получить ответ от модели.';
    if (completion.choices && completion.choices[0] && completion.choices[0].message && completion.choices[0].message.content) {
      answer = completion.choices[0].message.content;
    }

    if (answer.length > 1000) {
      answer = answer.slice(0, 997) + '...';
    }

    return res.status(200).json({
      version: version,
      session: session,
      response: {
        text: answer,
        end_session: false,
      },
    });
  } catch (error) {
    console.error('Ошибка обработки запроса:', error);

    return res.status(200).json({
      version: '1.0',
      session: req.body && req.body.session ? req.body.session : {},
      response: {
        text: 'Ошибка сервера: ' + error.message,
        end_session: false,
      },
    });
  }
}
