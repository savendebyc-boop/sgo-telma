# 🚀 Инструкции по развертыванию

## 📦 Развертывание Backend

### 1. Vercel (Рекомендуется)

**Подготовка:**
1. Установите Vercel CLI:
```bash
npm install -g vercel
```

2. Создайте файл `vercel.json`:
```json
{
  "version": 2,
  "builds": [
    {
      "src": "server.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "/server.js"
    }
  ],
  "env": {
    "NODE_ENV": "production"
  }
}
```

**Развертывание:**
```bash
vercel
```

**Получение URL:**
После развертывания вы получите URL вида: `https://your-app.vercel.app`

---

### 2. Railway

**Шаги:**
1. Зарегистрируйтесь на [Railway](https://railway.app)
2. Создайте новый проект
3. Подключите GitHub репозиторий или загрузите файлы
4. Railway автоматически определит Node.js проект
5. Добавьте переменные окружения в настройках
6. Railway предоставит публичный URL

**Переменные окружения в Railway:**
- `PORT` - автоматически
- `NODE_ENV` - production

---

### 3. Render

**Шаги:**
1. Зарегистрируйтесь на [Render](https://render.com)
2. Создайте новый Web Service
3. Подключите репозиторий
4. Настройки:
   - Build Command: `npm install`
   - Start Command: `npm start`
5. Добавьте переменные окружения
6. Deploy!

---

### 4. Heroku

**Подготовка:**
1. Создайте файл `Procfile`:
```
web: node server.js
```

**Развертывание:**
```bash
# Установите Heroku CLI
npm install -g heroku

# Войдите в Heroku
heroku login

# Создайте приложение
heroku create your-app-name

# Добавьте переменные окружения
heroku config:set NODE_ENV=production

# Deploy
git push heroku main
```

---

### 5. DigitalOcean App Platform

**Шаги:**
1. Создайте аккаунт на [DigitalOcean](https://digitalocean.com)
2. Перейдите в App Platform
3. Создайте новое приложение
4. Подключите GitHub
5. Выберите ваш репозиторий
6. Настройте:
   - Build Command: `npm install`
   - Run Command: `npm start`
7. Deploy

---

## 🌐 Развертывание Frontend

### 1. GitHub Pages (Простейший вариант)

**Шаги:**
1. Создайте репозиторий на GitHub
2. Загрузите `index.html`
3. Перейдите в Settings → Pages
4. Выберите ветку для публикации
5. Сохраните

**URL:** `https://username.github.io/repository-name/`

**Важно:** Обновите `API_URL` в `index.html`:
```javascript
const API_URL = 'https://your-backend-url.vercel.app';
```

---

### 2. Netlify

**Способ A: Через веб-интерфейс**
1. Зарегистрируйтесь на [Netlify](https://netlify.com)
2. Перетащите папку с `index.html` в Netlify Drop
3. Получите URL

**Способ B: Через CLI**
```bash
npm install -g netlify-cli
netlify deploy
```

**Настройка переменных:**
Создайте файл `netlify.toml`:
```toml
[build]
  publish = "."
  
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

---

### 3. Vercel (для Frontend)

```bash
# Создайте папку public
mkdir public
mv index.html public/

# Deploy
vercel --prod
```

---

## 🔧 Настройка Telegram Mini App

### Шаг 1: Получение Bot Token

1. Откройте [@BotFather](https://t.me/BotFather)
2. Отправьте `/newbot`
3. Введите имя: `SGO Diary Bot`
4. Введите username: `sgo_diary_bot`
5. Сохраните токен

### Шаг 2: Создание Mini App

1. Отправьте `/newapp` в @BotFather
2. Выберите бота
3. Заполните информацию:
   - Title: `Сетевой Город`
   - Description: `Электронный дневник для учеников`
   - Photo: Загрузите иконку (512x512 px)
   - Demo: Пропустите
   - Short name: `sgo` (уникальное имя)

### Шаг 3: Настройка Web App URL

1. Отправьте `/myapps` в @BotFather
2. Выберите ваше приложение
3. Выберите "Edit Web App URL"
4. Введите URL: `https://your-frontend-url.github.io/`

### Шаг 4: Настройка кнопки меню (опционально)

```
/setmenubutton
Выберите бота
Введите текст: Открыть дневник
Введите URL: https://your-frontend-url
```

---

## 🔐 Настройка HTTPS

### Для локальной разработки (ngrok)

```bash
# Установите ngrok
npm install -g ngrok

# Создайте туннель для backend
ngrok http 3000

# Скопируйте HTTPS URL
# Обновите API_URL в frontend
```

### Для production

Все перечисленные хостинги (Vercel, Railway, Render) автоматически предоставляют HTTPS.

---

## 🗄️ Настройка Redis (для production)

### Установка Redis

**На Heroku:**
```bash
heroku addons:create heroku-redis:hobby-dev
```

**На Railway:**
Добавьте Redis plugin через веб-интерфейс

**На VPS:**
```bash
sudo apt-get update
sudo apt-get install redis-server
sudo systemctl start redis
```

### Обновление кода для Redis

Установите зависимость:
```bash
npm install ioredis
```

Обновите `server.js`:
```javascript
const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL);

// Замените sessions Map на Redis
async function setSession(sessionId, data) {
  await redis.set(`session:${sessionId}`, JSON.stringify(data), 'EX', 3600);
}

async function getSession(sessionId) {
  const data = await redis.get(`session:${sessionId}`);
  return data ? JSON.parse(data) : null;
}
```

---

## 📊 Мониторинг и логирование

### Добавление Winston для логирования

```bash
npm install winston
```

Создайте `logger.js`:
```javascript
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

module.exports = logger;
```

---

## 🧪 Тестирование

### Локальное тестирование

1. Запустите backend:
```bash
npm start
```

2. Откройте `index.html` в браузере напрямую (для первичной проверки)

3. Или используйте локальный сервер:
```bash
npx http-server -p 8080
```

### Тестирование в Telegram

1. Используйте Telegram Web или Desktop для отладки
2. Откройте Developer Tools (F12)
3. Проверьте Console и Network tabs

---

## 🔄 CI/CD

### GitHub Actions для автодеплоя

Создайте `.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v2
    
    - name: Setup Node.js
      uses: actions/setup-node@v2
      with:
        node-version: '16'
    
    - name: Install dependencies
      run: npm install
    
    - name: Deploy to Vercel
      uses: amondnet/vercel-action@v20
      with:
        vercel-token: ${{ secrets.VERCEL_TOKEN }}
        vercel-org-id: ${{ secrets.ORG_ID }}
        vercel-project-id: ${{ secrets.PROJECT_ID }}
```

---

## 🛡️ Безопасность в Production

### 1. Защита от DDoS

Используйте Cloudflare:
1. Добавьте домен в Cloudflare
2. Включите "Under Attack Mode" при необходимости

### 2. Rate Limiting

Установите:
```bash
npm install express-rate-limit
```

Добавьте в `server.js`:
```javascript
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 100 // 100 запросов
});

app.use('/api/', limiter);
```

### 3. Helmet для безопасности заголовков

```bash
npm install helmet
```

```javascript
const helmet = require('helmet');
app.use(helmet());
```

---

## 📱 Проверка работоспособности

### Чеклист перед запуском:

- [ ] Backend развернут и доступен по HTTPS
- [ ] Frontend развернут и доступен по HTTPS
- [ ] API_URL в frontend указывает на backend
- [ ] Telegram Bot создан
- [ ] Mini App создано и настроено
- [ ] URL Mini App указывает на frontend
- [ ] Тестовый вход работает
- [ ] Данные загружаются корректно
- [ ] Сессии сохраняются
- [ ] Кнопка "Назад" работает
- [ ] Выход работает

---

## 🆘 Частые проблемы

### CORS ошибки
**Решение:** Убедитесь, что backend и frontend на HTTPS

### Mixed Content
**Решение:** Все ресурсы должны загружаться по HTTPS

### Mini App не открывается
**Решение:** Проверьте URL в @BotFather, убедитесь в HTTPS

### Сессия не сохраняется
**Решение:** Проверьте поддержку localStorage в Telegram

---

**Готово! Ваше приложение готово к работе! 🎉**
