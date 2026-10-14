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
          text: 'Здравствуйте! Я ваш голосовой помощник Джарвис на базе нейросети. Чем могу помочь?',
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
