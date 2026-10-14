import Groq from 'groq-sdk';

// Встроенная оперативная память на сервере (работает даже без галочки в Яндексе)
const serverMemory = {};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ status: 'ok', message: 'Webhook is active' });
  }

  try {
    const body = req.body ? req.body : {};
    const request = body.request ? body.request : {};
    const session = body.session ? body.session : {};
    const version = body.version ? body.version : '1.0';

    // Определяем уникальный ID пользователя
    let userId = 'default_user';
    if (session.user && session.user.user_id) {
      userId = session.user.user_id;
    } else if (session.application && session.application.application_id) {
      userId = session.application.application_id;
    } else if (session.session_id) {
      userId = session.session_id;
    }

    // Достаем историю: сначала из Яндекс Хранилища (user / session), иначе из памяти сервера
    const stateSession = body.state && body.state.session ? body.state.session : {};
    const stateUser = body.state && body.state.user ? body.state.user : {};

    let history = [];
    if (Array.isArray(stateSession.history) && stateSession.history.length > 0) {
      history = stateSession.history;
    } else if (Array.isArray(stateUser.history) && stateUser.history.length > 0) {
      history = stateUser.history;
    } else if (Array.isArray(serverMemory[userId])) {
      history = serverMemory[userId];
    }

    let userText = '';
    if (request.command) {
      userText = request.command;
    } else if (request.original_utterance) {
      userText = request.original_utterance;
    }

    // Приветствие при запуске навыка
    if (session.new && !userText) {
      return res.status(200).json({
        version: version,
        session: session,
        session_state: { history: history.slice(-4) },
        response: {
          text: 'Доброго времени суток, сэр. Все системы в норме, модули памяти активны. Джарвис к вашим услугам.',
          tts: 'Доброго времени суток, с+эр. sil <[250]> Все системы в норме. sil <[200]> Джарвис к вашим услугам.',
          end_session: false,
        },
      });
    }

    if (!userText.trim()) {
      return res.status(200).json({
        version: version,
        session: session,
        session_state: { history: history.slice(-4) },
        response: {
          text: 'Я внимательно слушаю вас, сэр. Каковы будут указания?',
          tts: 'Я внимательно слушаю вас, с+эр. sil <[250]> Каковы будут указания?',
          end_session: false,
        },
      });
    }

    const lowerText = userText.toLowerCase();

    // Команда полной очистки памяти
    if (lowerText.includes('очисти память')  lowerText.includes('забудь все')  lowerText.includes('забудь всё')) {
      serverMemory[userId] = [];
      return res.status(200).json({
        version: version,
        session: session,
        session_state: { history: [] },
        user_state_update: { history: [] },
        response: {
          text: 'Как пожелаете, сэр. Память диалога полностью очищена.',
          tts: 'Как пожелаете, с+эр. sil <[250]> Память диалога полностью очищена.',
          end_session: false,
        },
      });
    }

    // Точное время и дата
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

    // Проверяем, не спрашивает ли пользователь про контекст самого диалога (тогда поиск в Google НЕ нужен!)
    const memoryWords = ['помнишь', 'говорили', 'сказал', 'разговаривали', 'обсуждали', 'до этого', 'только что', 'о чем мы', 'о чём мы'];
    const isMemoryQuestion = memoryWords.some(function(w) { return lowerText.includes(w); });

    // Включаем поиск Serper только для информационных запросов (новости, факты, курсы и т.д.)
    const searchTriggers = ['найди', 'поищи', 'загугли', 'новости', 'курс', 'сколько стоит', 'кто такой', 'что такое', 'когда выйдет', 'сюжет', 'фильм', 'сериал', 'игра', 'год', 'где находится'];
    const needsSearch = searchTriggers.some(function(w) { return lowerText.includes(w); });

    if (!liveDataContext && !isMemoryQuestion && needsSearch && process.env.SERPER_API_KEY) {
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
          const snippets = serperData.organic.slice(0, 2).map(function(item) {
            return item.title + ': ' + item.snippet;
          }).join(' | ');
          liveDataContext = 'СПРАВОЧНЫЕ ДАННЫЕ ИЗ ИНТЕРНЕТА: ' + snippets;
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

    // Формируем краткую сводку предыдущих реплик прямо в системный промпт, чтобы модель 100% их видела
    let historySummary = '';
    if (history.length > 0) {
      const lines = history.map(function(item) {
        return (item.role === 'user' ? 'Сэр сказал: ' : 'Джарвис ответил: ') + item.content;
      });
      historySummary = 'ИСТОРИЯ НАШЕГО ТЕКУЩЕГО РАЗГОВОРА (ты ОБЯЗАН её помнить): ' + lines.join(' / ') + '. ';
    }
    const systemPrompt = 'Ты — ДЖАРВИС, высокоинтеллектуальный ИИ Тони Старка из фильма Железный человек. ' +
      'СЕЙЧАС: ' + currentDateString + ' (14 октября 2026 года). ' +
      historySummary +
      (liveDataContext ? liveDataContext + ' ' : '') +
      'Стиль: безупречно вежливый, спокойный, с легкой британской иронией. ' +
      'Правила: ' +
      '1. ОБЯЗАТЕЛЬНО обращайся к пользователю «сэр» в каждом ответе. ' +
      '2. Внимательно следи за ИСТОРИЕЙ РАЗГОВОРА. Никогда не говори, что мы только что начали общение, если в истории уже есть реплики! ' +
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

    if (answer.length > 800) {
      answer = answer.slice(0, 797) + '...';
    }

    const ttsAnswer = answer
      .split('сэр').join('с+эр')
      .split('Сэр').join('С+эр')
      .split('. ').join('. sil <[250]> ')
      .split(', ').join(', sil <[120]> ');

    // Обновляем историю (обрезаем каждую реплику до 140 символов, чтобы никогда не превысить лимит 1 КБ в Яндекс Хранилище!)
    history.push({ role: 'user', content: userText.slice(0, 140) });
    history.push({ role: 'assistant', content: answer.slice(0, 140) });
    if (history.length > 6) {
      history = history.slice(history.length - 6);
    }

    // Сохраняем в серверную память
    serverMemory[userId] = history;

    return res.status(200).json({
      version: version,
      session: session,
      session_state: {
        history: history,
      },
      user_state_update: {
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
