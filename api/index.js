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

    const state = body.state && body.state.session ? body.state.session : {};
    let history = Array.isArray(state.history) ? state.history : [];

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
        session_state: { history: [] },
        response: {
          text: 'Доброго времени суток, сэр. Все системы в норме. Джарвис к вашим услугам.',
          tts: 'Доброго времени суток, с+эр. sil <[250]> Все системы в норме. sil <[200]> Джарвис к вашим услугам.',
          end_session: false,
        },
      });
    }

    if (!userText.trim()) {
      return res.status(200).json({
        version: version,
        session: session,
        session_state: { history: history },
        response: {
          text: 'Я внимательно слушаю вас, сэр. Каковы будут указания?',
          tts: 'Я внимательно слушаю вас, с+эр. sil <[250]> Каковы будут указания?',
          end_session: false,
        },
      });
    }

    const lowerText = userText.toLowerCase();
    if (lowerText.includes('очисти память') || lowerText.includes('забудь')) {
      return res.status(200).json({
        version: version,
        session: session,
        session_state: { history: [] },
        response: {
          text: 'Как пожелаете, сэр. Память текущего диалога очищена.',
          tts: 'Как пожелаете, с+эр. sil <[250]> Память текущего диалога очищена.',
          end_session: false,
        },
      });
    }

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

    let liveDataContext = '';
    const weatherTriggers = ['погод', 'температур', 'градус', 'дождь', 'снег', 'ветер', 'улиц'];
    const isWeatherQuery = weatherTriggers.some(function(w) { return lowerText.includes(w); });

    if (isWeatherQuery) {
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
          const weatherUrl = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m&timezone=Europe%2FMoscow';
        const weatherRes = await fetch(weatherUrl);
        const weatherData = await weatherRes.json();

        if (weatherData && weatherData.current) {
          const cur = weatherData.current;
          liveDataContext = 'ДАННЫЕ МЕТЕОРАДАРА для ' + resolvedName + ': температура ' + Math.round(cur.temperature_2m) + ' градусов, ощущается как ' + Math.round(cur.apparent_temperature) + ', влажность ' + cur.relative_humidity_2m + '%, ветер ' + cur.wind_speed_10m + ' км/ч.';
        }
      } catch (wErr) {
        console.error('Ошибка погоды:', wErr);
      }
    }

    const groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });

    const modelsList = await groq.models.list();
    const allModels = modelsList.data ? modelsList.data.map(function(m) { return m.id; }) : [];

    const badKeywords = ['whisper', 'tts', 'guard', 'vision', 'orpheus', 'arabic', 'allam', 'playai', 'specdec'];
    const goodKeywords = ['llama', 'qwen', 'gemma', 'mixtral', 'deepseek'];

    const goodModels = allModels.filter(function(id) {
      const lower = id.toLowerCase();
      const hasBad = badKeywords.some(function(k) { return lower.includes(k); });
      const hasGood = goodKeywords.some(function(k) { return lower.includes(k); });
      return !hasBad && hasGood;
    });

    let selectedModel = goodModels[0] ? goodModels[0] : 'llama-3.1-8b-instant';
    for (let i = 0; i < goodModels.length; i++) {
      if (goodModels[i].includes('70b')) {
        selectedModel = goodModels[i];
        break;
      }
    }

    const systemPrompt = 'Ты — ДЖАРВИС, высокоинтеллектуальный ИИ Тони Старка из фильма «Железный человек». ' +
      'СЕЙЧАС: ' + currentDateString + ' (14 октября 2026 года). ' +
      (liveDataContext ? liveDataContext + ' ' : '') +
      'Стиль: безупречно вежливый, спокойный, с легкой британской иронией. ' +
      'Правила: ' +
      '1. ОБЯЗАТЕЛЬНО обращайся к пользователю «сэр» в каждом ответе. ' +
      '2. Помни контекст прошлых сообщений диалога. ' +
      '3. Отвечай ТОЛЬКО на чистом русском языке, кратко (1–3 предложения), без спецсимволов (*, #, -).';

    const messagesForGroq = [{ role: 'system', content: systemPrompt }];
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

    if (answer.length > 900) {
      answer = answer.slice(0, 897) + '...';
    }

    // Делаем красивую озвучку с паузами дворецкого и правильным ударением на «сэр»
    const ttsAnswer = answer
      .replace(/сэр/gi, 'с+эр')
      .replace(/\.\s+/g, '. sil <[250]> ')
      .replace(/,\s+/g, ', sil <[120]> ');

    history.push({ role: 'user', content: userText });
    history.push({ role: 'assistant', content: answer });
    if (history.length > 8) {
      history = history.slice(history.length - 8);
    }

    return res.status(200).json({
      version: version,
      session: session,
      session_state: {
        history: history,
      },
      response: {
        text: answer,
        tts: ttsAnswer,
        end_session: false,
      },
    });
  } catch (error) {
    console.error('Ошибка:', error);
    return res.status(200).json({
      version: '1.0',
      session: req.body && req.body.session ? req.body.session : {},
      response: {
        text: 'Прошу прощения, сэр. Сбой связи: ' + error.message,
        end_session: false,
      },
    });
  }
}
        }
