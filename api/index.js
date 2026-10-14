import Groq from 'groq-sdk';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ status: 'ok', message: 'Webhook is active' });
  }

  try {
    const body = req.body ? req.body : {};
    const request = body.request ? req.request : (body.request ? body.request : {});
    const session = body.session ? body.session : {};
    const version = body.version ? body.version : '1.0';

    // Достаем историю прошлых сообщений из памяти текущей сессии Яндекса
    const state = body.state && body.state.session ? body.state.session : {};
    let history = Array.isArray(state.history) ? state.history : [];

    let userText = '';
    if (request.command) {
      userText = request.command;
    } else if (request.original_utterance) {
      userText = request.original_utterance;
    }

    // Приветствие при первом запуске
    if (session.new && !userText) {
      return res.status(200).json({
        version: version,
        session: session,
        session_state: { history: [] },
        response: {
          text: 'Доброго времени суток, сэр. Все системы в норме, модули памяти и метеорадар активны. Джарвис к вашим услугам.',
          end_session: false,
        },
      });
    }

    // Если пользователь промолчал
    if (!userText.trim()) {
      return res.status(200).json({
        version: version,
        session: session,
        session_state: { history: history },
        response: {
          text: 'Я внимательно слушаю вас, сэр. Каковы будут указания?',
          end_session: false,
        },
      });
    }

    // Команда очистки памяти (если захотите начать тему заново)
    const lowerText = userText.toLowerCase();
    if (lowerText.includes('очисти память')  lowerText.includes('забудь все')  lowerText.includes('забудь всё')) {
      return res.status(200).json({
        version: version,
        session: session,
        session_state: { history: [] },
        response: {
          text: 'Как пожелаете, сэр. Буфер кратковременной памяти текущего диалога полностью очищен.',
          end_session: false,
        },
      });
    }

    // 1. Точное время и дата (Москва / СПб)
    const now = new Date();
    const currentDateString = now.toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    // 2. Блок живой погоды (Open-Meteo)
    let liveDataContext = '';
    if (
      lowerText.includes('погод') ||
      lowerText.includes('температур') ||
      lowerText.includes('градус') ||
      lowerText.includes('дождь') ||
      lowerText.includes('снег') ||
      lowerText.includes('ветер') ||
      lowerText.includes('улиц')
    ) {
      try {
        let cityQuery = 'Мурино';
        const words = lowerText.replace(/[^а-яёa-z\s-]/gi, '').split(/\s+/);
        const stopWords = [
          'какая', 'какой', 'погода', 'температура', 'сейчас', 'сегодня',
          'завтра', 'в', 'во', 'на', 'улице', 'градусов', 'скажи', 'джарвис',
          'сэр', 'а', 'что', 'с', 'погодой', 'там', 'будет'
        ];
        const cityWords = words.filter(function(w) {
          return w.length > 2 && !stopWords.includes(w);
        });

        if (cityWords.length > 0) {
          cityQuery = cityWords[cityWords.length - 1];
        }

        let lat = 60.0494;
        let lon = 30.4464;
        let resolvedName = 'Мурино (Санкт-Петербург)';

        if (!cityQuery.startsWith('мурин') && !cityQuery.startsWith('питер') && !cityQuery.startsWith('санкт')) {
          const geoUrl = 'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(cityQuery) + '&count=1&language=ru';
          const geoRes = await fetch(geoUrl);
          const geoData = await geoRes.json();
          if (geoData.results && geoData.results.length > 0) {
            lat = geoData.results[0].latitude;
            lon = geoData.results[0].longitude;
            resolvedName = geoData.results[0].name;
          }
        }
        const weatherUrl = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&timezone=Europe%2FMoscow';
        const weatherRes = await fetch(weatherUrl);
        const weatherData = await weatherRes.json();

        if (weatherData && weatherData.current) {
          const cur = weatherData.current;
          liveDataContext = 'ДАННЫЕ МЕТЕОРАДАРА В РЕАЛЬНОМ ВРЕМЕНИ для локации ' + resolvedName + ': ' +
            'температура воздуха ' + Math.round(cur.temperature_2m) + ' градусов Цельсия, ' +
            'ощущается как ' + Math.round(cur.apparent_temperature) + ' градусов, ' +
            'влажность ' + cur.relative_humidity_2m + ' процентов, ' +
            'скорость ветра ' + cur.wind_speed_10m + ' километров в час. ' +
            'Обязательно сообщи эти точные цифры пользователю!';
        }
      } catch (wErr) {
        console.error('Ошибка получения погоды:', wErr);
      }
    }

    // 3. Поиск в Google через Serper (если подключен SERPER_API_KEY)
    if (!liveDataContext && process.env.SERPER_API_KEY) {
      try {
        const serperRes = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: {
            'X-API-KEY': process.env.SERPER_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ q: userText, gl: 'ru', hl: 'ru' }),
        });
        const serperData = await serperRes.json();
        if (serperData.organic && serperData.organic.length > 0) {
          const snippets = serperData.organic.slice(0, 3).map(function(item) {
            return item.title + ': ' + item.snippet;
          }).join(' | ');
          liveDataContext = 'ДАННЫЕ ИЗ ИНТЕРНЕТА В РЕАЛЬНОМ ВРЕМЕНИ: ' + snippets;
        }
      } catch (sErr) {
        console.error('Ошибка поиска Serper:', sErr);
      }
    }

    const groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });

    const modelsList = await groq.models.list();
    const allModels = modelsList.data ? modelsList.data.map(function(m) { return m.id; }) : [];

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

    let selectedModel = goodModels[0] ? goodModels[0] : 'llama-3.1-8b-instant';
    for (let i = 0; i < goodModels.length; i++) {
      if (goodModels[i].includes('70b')) {
        selectedModel = goodModels[i];
        break;
      }
    }

    const systemPrompt = 'Ты — ДЖАРВИС (J.A.R.V.I.S.), высокоинтеллектуальный бортовой ИИ Тони Старка из фильма «Железный человек». ' +
      'СЕЙЧАС В РЕАЛЬНОМ МИРЕ: ' + currentDateString + ' (14 октября 2026 года, время московское). ' +
      (liveDataContext ? liveDataContext + ' ' : '') +
      'Твой стиль: безупречно вежливый, спокойный, с тонкой британской иронией. ' +
      'Правила: ' +
      '1. ОБЯЗАТЕЛЬНО обращайся к пользователю «сэр» в каждом ответе. ' +
      '2. Используй фразы «Да, сэр», «К вашим услугам, сэр», «По данным моих сенсоров, сэр», «Все системы в норме, сэр». ' +
      '3. Учитывай историю нашего диалога и помни, о чем мы говорили только что. ' +
      '4. Отвечай ТОЛЬКО на чистом русском языке, кратко (2–3 предложения), без спецсимволов (*, #, -).';
    // Собираем массив сообщений: Системная инструкция + История прошлых реплик + Новый вопрос
    const messagesForGroq = [
      { role: 'system', content: systemPrompt }
    ];

    for (let j = 0; j < history.length; j++) {
      messagesForGroq.push(history[j]);
    }

    messagesForGroq.push({ role: 'user', content: userText });

    const completion = await groq.chat.completions.create({
      messages: messagesForGroq,
      model: selectedModel,
      temperature: 0.5,
    });

    let answer = 'Прошу прощения, сэр, возникла временная помеха на линии связи.';
    if (completion.choices && completion.choices[0] && completion.choices[0].message && completion.choices[0].message.content) {
      answer = completion.choices[0].message.content;
    }

    answer = answer.replace(/<think>[\s\S]*?<\/think>/gi, '');
    answer = answer.replace(/[*#_~`]/g, '').trim();

    if (answer.length > 1000) {
      answer = answer.slice(0, 997) + '...';
    }

    // Сохраняем текущую реплику пользователя и ответ Джарвиса в историю (храним последние 10 реплик)
    history.push({ role: 'user', content: userText });
    history.push({ role: 'assistant', content: answer });
    if (history.length > 10) {
      history = history.slice(history.length - 10);
    }

    return res.status(200).json({
      version: version,
      session: session,
      session_state: {
        history: history,
      },
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
