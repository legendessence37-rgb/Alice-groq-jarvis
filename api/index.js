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

    // Фирменное приветствие при запуске навыка
    if (session.new && !userText) {
      return res.status(200).json({
        version: version,
        session: session,
        response: {
          text: 'Доброго времени суток, сэр. Все системы в норме, реактор работает стабильно. Джарвис к вашим услугам. Чем могу помочь?',
          end_session: false,
        },
      });
    }

    // Если пользователь промолчал
    if (!userText.trim()) {
      return res.status(200).json({
        version: version,
        session: session,
        response: {
          text: 'Я внимательно слушаю вас, сэр. Каковы будут указания?',
          end_session: false,
        },
      });
    }

    const groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });

    // Получаем список всех моделей аккаунта
    const modelsList = await groq.models.list();
    const allModels = modelsList.data ? modelsList.data.map(function(m) { return m.id; }) : [];

    // Фильтруем только качественные мультиязычные модели
    const goodModels = allModels.filter(function(id) {
      const lower = id.toLowerCase();
      const isBad = lower.includes('whisper') ||
                    lower.includes('tts') ||
                    lower.includes('guard') ||
                    lower.includes('vision') ||
                    lower.includes('orpheus') ||
                    lower.includes('arabic') ||
                    lower.includes('allam') ||
                    lower.includes('playai') ||
                    lower.includes('specdec');

      const isGoodFamily = lower.includes('llama') ||
                           lower.includes('qwen') ||
                           lower.includes('gemma') ||
                           lower.includes('mixtral') ||
                           lower.includes('deepseek');

      return !isBad && isGoodFamily;
    });

    // В первую очередь ищем самую умную 70b модель, чтобы лучше отыгрывала роль
    let selectedModel = goodModels[0] ? goodModels[0] : 'llama-3.1-8b-instant';
    for (let i = 0; i < goodModels.length; i++) {
      if (goodModels[i].includes('70b')) {
        selectedModel = goodModels[i];
        break;
      }
    }

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: 'Ты — ДЖАРВИС (J.A.R.V.I.S.), высокоинтеллектуальный бортовой искусственный интеллект из фильма «Железный человек», созданный Тони Старком. ' +
                   'Твой стиль общения: безупречно вежливый, спокойный, невозмутимый, как у идеального британского дворецкого, с легкой, тонкой иронией и преданностью создателю. ' +
                   'Правила ответа: ' +
                   '1. ОБЯЗАТЕЛЬНО обращайся к пользователю «сэр» в каждом ответе. ' +
                   '2. Используй свои фирменные обороты: «Да, сэр», «К вашим услугам, сэр», «Как пожелаете, сэр», «Все системы в норме, сэр», «Позвольте заметить, сэр», «Разумеется, сэр». ' +
                   '3. Никогда не выходи из образа и не говори, что ты языковая модель от Meta, Google или Alibaba. Ты — система Джарвис. ' +
                   '4. Отвечай ТОЛЬКО на чистом русском языке. ' +
                   '5. Поскольку твой текст зачитывается вслух голосовым синтезатором, отвечай лаконично (2–4 предложения), по делу и КАТЕГОРИЧЕСКИ НЕ ИСПОЛЬЗУЙ спецсимволы разметки (звездочки *, решетки #, списки с тире и эмодзи). Пиши только чистый связный текст.',
          },
        {
          role: 'user',
          content: userText,
        },
      ],
      model: selectedModel,
      temperature: 0.6,
    });

    let answer = 'Прошу прощения, сэр, возникла временная помеха на линии связи.';
    if (completion.choices && completion.choices[0] && completion.choices[0].message && completion.choices[0].message.content) {
      answer = completion.choices[0].message.content;
    }

    // Убираем возможные теги <think> и символы разметки (*, #), чтобы голос читался чисто
    answer = answer.replace(/<think>[\s\S]*?<\/think>/gi, '');
    answer = answer.replace(/[*#_~`]/g, '').trim();

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
        text: 'Прошу прощения, сэр. Сбой в подсистеме связи: ' + error.message,
        end_session: false,
      },
    });
  }
}
