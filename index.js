require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');

const app = express();
const port = process.env.PORT || 3000;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);

const userCredentials = {};

app.use(express.json());

app.get('/', (req, res) => {
    res.send('Hello World');
});

app.post('/webhook', (req, res) => {
    const update = req.body;
    bot.processUpdate(update);
    res.sendStatus(200);
});

async function isSessionValid(session) {
    const homeUrl = "https://daotao.qnu.edu.vn/Home";
    try {
        const response = await session.get(homeUrl);
        return response.status === 200;
    } catch (error) {
        return false;
    }
}

async function loginToSchool(username, password) {
    const loginUrl = "https://daotao.qnu.edu.vn/Login";
    const payload = { txtTaiKhoan: username, txtMatKhau: password };
    const session = axios.create({
        withCredentials: true,
        headers: {
            'Cookie': `ASP.NET_SessionId=2bu2v5or2dd5asah5mnlajve`
        }
    });

    try {
        const response = await session.post(loginUrl, payload);
        if (response.status === 302) {
            return session;
        }
    } catch (error) {
        console.error('Đăng nhập thất bại:', error);
    }
    return null;
}

async function checkNewGrades() {
    for (const [chatId, credentials] of Object.entries(userCredentials)) {
        const { username, password, session } = credentials;

        if (!(await isSessionValid(session))) {
            const newSession = await loginToSchool(username, password);
            if (!newSession) {
                bot.sendMessage(chatId, "Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại bằng lệnh /login.");
                continue;
            }
            credentials.session = newSession;
        }

        const marksUrl = "https://daotao.qnu.edu.vn/Home/Marks";
        const response = await session.get(marksUrl);
        const $ = cheerio.load(response.data);
        const newGrades = [];

        $('tr').each((i, row) => {
            const cells = $(row).find('td');
            if (cells.length > 4 && $(cells[4]).text().includes('Khảo sát để xem điểm')) {
                newGrades.push($(cells[2]).text().trim());
            }
        });

        if (newGrades.length > 0) {
            bot.sendMessage(chatId, `Các môn học sau đã có điểm: ${newGrades.join(', ')}`);
        }
    }
}

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "Chào mừng bạn đến với bot kiểm tra điểm! Sử dụng lệnh /login để đăng nhập.");
});

bot.onText(/\/login/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "Vui lòng nhập mã sinh viên của bạn:");
    bot.once('message', (msg) => {
        const username = msg.text;
        bot.sendMessage(chatId, "Vui lòng nhập mật khẩu của bạn:");
        bot.once('message', async (msg) => {
            const password = msg.text;
            const session = await loginToSchool(username, password);
            if (session) {
                userCredentials[chatId] = { username, password, session };
                bot.sendMessage(chatId, "Đăng nhập thành công! Bot sẽ thông báo khi có điểm mới.");
            } else {
                bot.sendMessage(chatId, "Đăng nhập thất bại. Vui lòng thử lại bằng lệnh /login.");
            }
        });
    });
});

bot.onText(/\/checkgrades/, async (msg) => {
    const chatId = msg.chat.id;
    if (userCredentials[chatId]) {
        await checkNewGrades();
    } else {
        bot.sendMessage(chatId, "Bạn chưa đăng nhập. Vui lòng sử dụng lệnh /login để đăng nhập.");
    }
});

bot.onText(/\/logout/, (msg) => {
    const chatId = msg.chat.id;
    if (userCredentials[chatId]) {
        delete userCredentials[chatId];
        bot.sendMessage(chatId, "Đăng xuất thành công! Bạn đã được xóa khỏi hệ thống.");
    } else {
        bot.sendMessage(chatId, "Bạn chưa đăng nhập. Vui lòng sử dụng lệnh /login để đăng nhập.");
    }
});

cron.schedule('*/15 * * * *', () => {
    console.log('Đang kiểm tra điểm mới...');
    checkNewGrades();
});

app.listen(port, () => {
    console.log(`Server đang chạy tại http://localhost:${port}`);
});