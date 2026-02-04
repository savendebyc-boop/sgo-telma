// server.js - Backend для интеграции с Сетевой Город. Образование
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Настройка middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Базовый URL СГО (можно изменить на нужный регион)
const SGO_BASE_URL = 'https://sgo.rso23.ru';

// Хранилище сессий (в продакшене использовать Redis)
const sessions = new Map();

// Утилита для создания cookie строки
function getCookieString(cookies) {
    return Object.entries(cookies)
        .map(([key, value]) => `${key}=${value}`)
        .join('; ');
}

// Утилита для парсинга cookies из headers
function parseCookies(setCookieHeaders) {
    const cookies = {};
    if (setCookieHeaders) {
        setCookieHeaders.forEach(cookie => {
            const parts = cookie.split(';')[0].split('=');
            cookies[parts[0]] = parts[1];
        });
    }
    return cookies;
}

// 1. Авторизация
app.post('/api/login', async (req, res) => {
    try {
        const { username, password, region } = req.body;

        // Определяем URL по региону
        let sgoUrl = SGO_BASE_URL;
        if (region === 'msk') sgoUrl = 'https://sgo.mos.ru';
        else if (region === 'spb') sgoUrl = 'https://sgo.spb.ru';

        console.log('Попытка входа:', username, 'на', sgoUrl);

        // Шаг 1: Получаем страницу входа для получения cookies и CSRF токена
        const loginPageResponse = await axios.get(`${sgoUrl}/webapi/logindata`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            }
        });

        const cookies = parseCookies(loginPageResponse.headers['set-cookie']);
        const loginData = loginPageResponse.data;

        // Шаг 2: Отправляем данные для входа
        const authResponse = await axios.post(
            `${sgoUrl}/webapi/auth/login`,
            {
                loginType: 1,
                cid: 2,
                sid: 23,
                pid: -1,
                cn: -1,
                sft: 2,
                scid: 2,
                UN: username,
                PW: password,
                lt: loginData.lt,
                pw2: '',
                ver: loginData.ver,
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Cookie': getCookieString(cookies),
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                }
            }
        );

        // Обновляем cookies после авторизации
        const authCookies = parseCookies(authResponse.headers['set-cookie']);
        Object.assign(cookies, authCookies);

        if (authResponse.data.at) {
            // Успешная авторизация
            const sessionId = Math.random().toString(36).substring(7);
            
            sessions.set(sessionId, {
                cookies,
                sgoUrl,
                accessToken: authResponse.data.at,
                userId: authResponse.data.accountInfo?.user?.id,
                userData: authResponse.data.accountInfo
            });

            res.json({
                success: true,
                sessionId,
                user: authResponse.data.accountInfo
            });
        } else {
            res.status(401).json({
                success: false,
                error: 'Неверный логин или пароль'
            });
        }

    } catch (error) {
        console.error('Ошибка авторизации:', error.response?.data || error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка при входе в систему',
            details: error.response?.data || error.message
        });
    }
});

// 2. Получение информации о пользователе
app.get('/api/user', async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace('Bearer ', '');
        const session = sessions.get(sessionId);

        if (!session) {
            return res.status(401).json({ error: 'Сессия не найдена' });
        }

        const response = await axios.get(
            `${session.sgoUrl}/webapi/context`,
            {
                headers: {
                    'Cookie': getCookieString(session.cookies),
                    'at': session.accessToken
                }
            }
        );

        res.json(response.data);
    } catch (error) {
        console.error('Ошибка получения данных пользователя:', error.message);
        res.status(500).json({ error: 'Ошибка получения данных' });
    }
});

// 3. Получение дневника
app.get('/api/diary', async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace('Bearer ', '');
        const session = sessions.get(sessionId);

        if (!session) {
            return res.status(401).json({ error: 'Сессия не найдена' });
        }

        const { weekStart, weekEnd, studentId } = req.query;

        const response = await axios.get(
            `${session.sgoUrl}/webapi/student/diary`,
            {
                params: {
                    studentId: studentId || session.userId,
                    weekStart,
                    weekEnd
                },
                headers: {
                    'Cookie': getCookieString(session.cookies),
                    'at': session.accessToken
                }
            }
        );

        res.json(response.data);
    } catch (error) {
        console.error('Ошибка получения дневника:', error.message);
        res.status(500).json({ error: 'Ошибка получения дневника' });
    }
});

// 4. Получение оценок
app.get('/api/grades', async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace('Bearer ', '');
        const session = sessions.get(sessionId);

        if (!session) {
            return res.status(401).json({ error: 'Сессия не найдена' });
        }

        const { studentId, periodId } = req.query;

        const response = await axios.get(
            `${session.sgoUrl}/webapi/student/grades`,
            {
                params: {
                    studentId: studentId || session.userId,
                    periodId: periodId || 0
                },
                headers: {
                    'Cookie': getCookieString(session.cookies),
                    'at': session.accessToken
                }
            }
        );

        res.json(response.data);
    } catch (error) {
        console.error('Ошибка получения оценок:', error.message);
        res.status(500).json({ error: 'Ошибка получения оценок' });
    }
});

// 5. Получение расписания
app.get('/api/schedule', async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace('Bearer ', '');
        const session = sessions.get(sessionId);

        if (!session) {
            return res.status(401).json({ error: 'Сессия не найдена' });
        }

        const { studentId, date } = req.query;

        const response = await axios.get(
            `${session.sgoUrl}/webapi/student/diary`,
            {
                params: {
                    studentId: studentId || session.userId,
                    date: date || new Date().toISOString().split('T')[0]
                },
                headers: {
                    'Cookie': getCookieString(session.cookies),
                    'at': session.accessToken
                }
            }
        );

        res.json(response.data);
    } catch (error) {
        console.error('Ошибка получения расписания:', error.message);
        res.status(500).json({ error: 'Ошибка получения расписания' });
    }
});

// 6. Получение домашнего задания
app.get('/api/homework', async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace('Bearer ', '');
        const session = sessions.get(sessionId);

        if (!session) {
            return res.status(401).json({ error: 'Сессия не найдена' });
        }

        const { studentId, fromDate, toDate } = req.query;

        const response = await axios.get(
            `${session.sgoUrl}/webapi/student/diary/assigns`,
            {
                params: {
                    studentId: studentId || session.userId,
                    fromDate,
                    toDate
                },
                headers: {
                    'Cookie': getCookieString(session.cookies),
                    'at': session.accessToken
                }
            }
        );

        res.json(response.data);
    } catch (error) {
        console.error('Ошибка получения домашнего задания:', error.message);
        res.status(500).json({ error: 'Ошибка получения домашнего задания' });
    }
});

// 7. Получение итоговых оценок
app.get('/api/total-marks', async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace('Bearer ', '');
        const session = sessions.get(sessionId);

        if (!session) {
            return res.status(401).json({ error: 'Сессия не найдена' });
        }

        const { studentId } = req.query;

        const response = await axios.get(
            `${session.sgoUrl}/webapi/student/total-marks`,
            {
                params: {
                    studentId: studentId || session.userId
                },
                headers: {
                    'Cookie': getCookieString(session.cookies),
                    'at': session.accessToken
                }
            }
        );

        res.json(response.data);
    } catch (error) {
        console.error('Ошибка получения итоговых оценок:', error.message);
        res.status(500).json({ error: 'Ошибка получения итоговых оценок' });
    }
});

// 8. Выход
app.post('/api/logout', async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace('Bearer ', '');
        const session = sessions.get(sessionId);

        if (session) {
            await axios.post(
                `${session.sgoUrl}/webapi/auth/logout`,
                {},
                {
                    headers: {
                        'Cookie': getCookieString(session.cookies),
                        'at': session.accessToken
                    }
                }
            );

            sessions.delete(sessionId);
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Ошибка при выходе:', error.message);
        res.status(500).json({ error: 'Ошибка при выходе' });
    }
});

// Проверка здоровья сервера
app.get('/health', (req, res) => {
    res.json({ status: 'ok', sessions: sessions.size });
});

app.listen(PORT, () => {
    console.log(`🚀 Backend сервер запущен на порту ${PORT}`);
    console.log(`📱 Telegram Mini App готов к работе`);
});
