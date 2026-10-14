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

    // Безопасное получение даты и времени (без toLocaleString, который ломается при копировании)
    const formatter = new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const currentDateString = formatter.format(new Date());

    let liveDataContext = '';
    const weatherTriggers = ['погод', 'температур', 'градус', 'дождь', 'снег', 'ветер', 'улиц'];
    const isWeatherQuery = weatherTriggers.some(function(w) { return lowerText.includes(w); });

    if (isWeatherQuery) {
      try {
        let lat = 60.0494;
        let lon = 30.4464;
        let resolvedName = 'Мурино (Санкт-Петербург)';

        if (lowerText.includes('москв')) {
          lat = 55.7558;
          lon = 37.6173;
          resolvedName = 'Москва';
        }

        const weatherUrl = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m&timezone=Europe%2FMoscow';
        const weatherRes = await fetch(weatherUrl);
        const weatherData = await weatherRes.json();

        if (weatherData && weatherData.current) {
          const cur = weatherData.current;
          liveDataContext = 'ДАННЫЕ МЕТЕОРАДАРА для ' + resolvedName + ': температура ' + Math.round(cur.temperature_2m) + ' градусов Цельсия, ощущается как ' + Math.round(cur.apparent_temperature) + ', влажность ' + cur.relative_humidity_2m + '%, ветер ' + cur.wind_speed_10m + ' км/ч.';
        }
      } catch (wErr) {
        console.error('Ошибка погоды:', wErr);
      }
    }
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
          liveDataContext = 'ДАННЫЕ ИЗ ИНТЕРНЕТА: ' + snippets;
        }
      } catch (sErr) {
        console.error('Ошибка Serper:', sErr);
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

    const systemPrompt = 'Ты — ДЖАРВИС, высокоинтеллектуальный ИИ Тони Старка из фильма Железный человек. ' +
      'СЕЙЧАС: ' + currentDateString + ' (14 октября 2026 года). ' +
      (liveDataContext ? liveDataContext + ' ' : '') +
      'Стиль: безупречно вежливый, спокойный, с легкой британской иронией. ' +
      'Правила: ' +
      '1. ОБЯЗАТЕЛЬНО обращайся к пользователю «сэр» в каждом ответе. ' +
      '2. Помни контекст прошлых сообщений нашего диалога. ' +
      '3. Отвечай ТОЛЬКО на чистом русском языке, кратко (1-3 предложения), без звездочек и решеток.';

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

    if (answer.includes('</think>')) {
      const parts = answer.split('</think>');
      answer = parts[parts.length - 1];
    }
    answer = answer.split('*').join('').split('#').join('').trim();

    if (answer.length > 900) {
      answer = answer.slice(0, 897) + '...';
    }

    const ttsAnswer = answer
      .split('сэр').join('с+эр')
      .split('Сэр').join('С+эр')
      .split('. ').join('. sil <[250]> ')
      .split(', ').join(', sil <[120]> ');

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

    // Поиск в интернете через Serper (если добавлен SERPER_API_KEY)
