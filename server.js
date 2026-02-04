// server.js - Backend для интеграции с Сетевой Город. Образование и Госуслуги
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const bodyParser = require('body-parser');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Настройка middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('.'));

// Базовый URL СГО (можно изменить на нужный регион)
const SGO_BASE_URL = process.env.SGO_BASE_URL || 'https://sgo.rso23.ru';

// Конфигурация Госуслуг (ESIA)
const ESIA_CONFIG = {
    // URL для тестовой среды (для продакшена использовать https://esia.gosuslugi.ru)
    baseUrl: process.env.ESIA_BASE_URL || 'https://esia-portal1.test.gosuslugi.ru',
    clientId: process.env.ESIA_CLIENT_ID || 'YOUR_CLIENT_ID', // Получить на gosuslugi.ru
    clientSecret: process.env.ESIA_CLIENT_SECRET || 'YOUR_CLIENT_SECRET',
    redirectUri: process.env.ESIA_REDIRECT_URI || 'http://localhost:3000/api/auth/esia/callback',
    scope: 'openid fullname birthdate snils email mobile',
    certificatePath: process.env.ESIA_CERT_PATH || './esia_cert.pem', // Путь к сертификату
    privateKeyPath: process.env.ESIA_KEY_PATH || './esia_key.pem' // Путь к приватному ключу
};

// Хранилище сессий (в продакшене использовать Redis)
const sessions = new Map();
const oauthStates = new Map(); // Для хранения state параметров OAuth

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

// Генерация случайного state для OAuth
function generateState() {
    return crypto.randomBytes(32).toString('hex');
}

// Генерация PKCE code verifier и challenge
function generatePKCE() {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto
        .createHash('sha256')
        .update(verifier)
        .digest('base64url');
    return { verifier, challenge };
}

// ==================== ГОСУСЛУГИ (ESIA) ENDPOINTS ====================

// 1. Инициализация OAuth авторизации через Госуслуги
app.get('/api/auth/esia/login', (req, res) => {
    try {
        const state = generateState();
        const { verifier, challenge } = generatePKCE();
        
        // Сохраняем state и verifier для последующей проверки
        oauthStates.set(state, {
            verifier,
            timestamp: Date.now(),
            telegramUserId: req.query.telegram_user_id
        });

        // Очистка старых state (старше 10 минут)
        for (const [key, value] of oauthStates.entries()) {
            if (Date.now() - value.timestamp > 600000) {
                oauthStates.delete(key);
            }
        }

        // Формируем URL для авторизации
        const authUrl = new URL(`${ESIA_CONFIG.baseUrl}/aas/oauth2/ac`);
        authUrl.searchParams.append('client_id', ESIA_CONFIG.clientId);
        authUrl.searchParams.append('client_secret', ESIA_CONFIG.clientSecret);
        authUrl.searchParams.append('redirect_uri', ESIA_CONFIG.redirectUri);
        authUrl.searchParams.append('scope', ESIA_CONFIG.scope);
        authUrl.searchParams.append('response_type', 'code');
        authUrl.searchParams.append('state', state);
        authUrl.searchParams.append('code_challenge', challenge);
        authUrl.searchParams.append('code_challenge_method', 'S256');
        authUrl.searchParams.append('access_type', 'online');
        authUrl.searchParams.append('timestamp', new Date().toISOString());

        res.json({
            success: true,
            authUrl: authUrl.toString()
        });

    } catch (error) {
        console.error('Ошибка инициализации ESIA:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка инициализации авторизации через Госуслуги'
        });
    }
});

// 2. Callback после авторизации через Госуслуги
app.get('/api/auth/esia/callback', async (req, res) => {
    try {
        const { code, state, error } = req.query;

        if (error) {
            return res.redirect(`/?error=${encodeURIComponent(error)}`);
        }

        if (!code || !state) {
            return res.redirect('/?error=missing_params');
        }

        // Проверяем state
        const stateData = oauthStates.get(state);
        if (!stateData) {
            return res.redirect('/?error=invalid_state');
        }

        oauthStates.delete(state);

        // Обмениваем authorization code на access token
        const tokenResponse = await axios.post(
            `${ESIA_CONFIG.baseUrl}/aas/oauth2/te`,
            new URLSearchParams({
                client_id: ESIA_CONFIG.clientId,
                code: code,
                grant_type: 'authorization_code',
                redirect_uri: ESIA_CONFIG.redirectUri,
                code_verifier: stateData.verifier,
                client_secret: ESIA_CONFIG.clientSecret,
                state: state,
                timestamp: new Date().toISOString(),
                token_type: 'Bearer',
                scope: ESIA_CONFIG.scope
            }).toString(),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        const { access_token, id_token, refresh_token } = tokenResponse.data;

        // Получаем информацию о пользователе
        const userInfoResponse = await axios.get(
            `${ESIA_CONFIG.baseUrl}/rs/prns/${extractOidFromToken(id_token)}`,
            {
                headers: {
                    'Authorization': `Bearer ${access_token}`
                }
            }
        );

        const userInfo = userInfoResponse.data;

        // Создаем сессию
        const sessionId = crypto.randomBytes(32).toString('hex');
        sessions.set(sessionId, {
            esiaToken: access_token,
            esiaRefreshToken: refresh_token,
            userInfo: {
                oid: userInfo.oid,
                firstName: userInfo.firstName,
                lastName: userInfo.lastName,
                middleName: userInfo.middleName,
                birthDate: userInfo.birthDate,
                snils: userInfo.snils,
                email: userInfo.email,
                mobile: userInfo.mobile
            },
            telegramUserId: stateData.telegramUserId,
            createdAt: Date.now()
        });

        // Перенаправляем обратно в приложение с sessionId
        res.redirect(`/?session=${sessionId}&auth=esia`);

    } catch (error) {
        console.error('Ошибка ESIA callback:', error.response?.data || error.message);
        res.redirect(`/?error=${encodeURIComponent('auth_failed')}`);
    }
});

// 3. Получение информации о пользователе ESIA
app.get('/api/auth/esia/user', async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace('Bearer ', '');
        const session = sessions.get(sessionId);

        if (!session || !session.esiaToken) {
            return res.status(401).json({ error: 'Сессия не найдена' });
        }

        res.json({
            success: true,
            user: session.userInfo,
            authType: 'esia'
        });

    } catch (error) {
        console.error('Ошибка получения данных ESIA:', error);
        res.status(500).json({ error: 'Ошибка получения данных' });
    }
});

// 4. Обновление токена ESIA
app.post('/api/auth/esia/refresh', async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace('Bearer ', '');
        const session = sessions.get(sessionId);

        if (!session || !session.esiaRefreshToken) {
            return res.status(401).json({ error: 'Сессия не найдена' });
        }

        const tokenResponse = await axios.post(
            `${ESIA_CONFIG.baseUrl}/aas/oauth2/te`,
            new URLSearchParams({
                client_id: ESIA_CONFIG.clientId,
                client_secret: ESIA_CONFIG.clientSecret,
                grant_type: 'refresh_token',
                refresh_token: session.esiaRefreshToken,
                scope: ESIA_CONFIG.scope
            }).toString(),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        session.esiaToken = tokenResponse.data.access_token;
        session.esiaRefreshToken = tokenResponse.data.refresh_token;

        res.json({ success: true });

    } catch (error) {
        console.error('Ошибка обновления токена ESIA:', error);
        res.status(500).json({ error: 'Ошибка обновления токена' });
    }
});

// Утилита для извлечения OID из JWT токена
function extractOidFromToken(token) {
    try {
        const payload = JSON.parse(
            Buffer.from(token.split('.')[1], 'base64').toString()
        );
        return payload.urn_esia_sbj_id || payload.sub;
    } catch (error) {
        console.error('Ошибка парсинга токена:', error);
        return null;
    }
}

// ==================== СЕТЕВОЙ ГОРОД ENDPOINTS ====================

// 1. Авторизация через логин/пароль СГО
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
            const sessionId = crypto.randomBytes(32).toString('hex');
            
            sessions.set(sessionId, {
                cookies,
                sgoUrl,
                accessToken: authResponse.data.at,
                userId: authResponse.data.accountInfo?.user?.id,
                userData: authResponse.data.accountInfo,
                authType: 'sgo'
            });

            res.json({
                success: true,
                sessionId,
                user: authResponse.data.accountInfo,
                authType: 'sgo'
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

// 2. Получение информации о пользователе СГО
app.get('/api/user', async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace('Bearer ', '');
        const session = sessions.get(sessionId);

        if (!session) {
            return res.status(401).json({ error: 'Сессия не найдена' });
        }

        // Если авторизация через ESIA, возвращаем данные ESIA
        if (session.authType === 'esia') {
            return res.json({
                success: true,
                user: session.userInfo,
                authType: 'esia'
            });
        }

        // Иначе получаем данные из СГО
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
            // Если авторизация через СГО, выходим из СГО
            if (session.authType === 'sgo' && session.sgoUrl) {
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
            }

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
    res.json({ 
        status: 'ok', 
        sessions: sessions.size,
        esiaEnabled: !!ESIA_CONFIG.clientId && ESIA_CONFIG.clientId !== 'YOUR_CLIENT_ID'
    });
});

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.listen(PORT, () => {
    console.log(`🚀 Backend сервер запущен на порту ${PORT}`);
    console.log(`📱 Telegram Mini App готов к работе`);
    console.log(`🔐 Авторизация через Госуслуги: ${ESIA_CONFIG.clientId !== 'YOUR_CLIENT_ID' ? 'ВКЛ' : 'ВЫКЛ'}`);
});
