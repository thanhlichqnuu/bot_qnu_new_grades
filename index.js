require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');

const app = express();
const port = process.env.PORT || 3000;

// Lấy Telegram Bot Token từ biến môi trường
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Khởi tạo Telegram Bot với Polling
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// Lưu trữ thông tin người dùng
const userCredentials = {};

// Middleware để xử lý JSON
app.use(express.json());

// Endpoint chính
app.get('/', (req, res) => {
    res.send('Hello World');
});

// Hàm kiểm tra hiệu lực phiên đăng nhập
async function isSessionValid(session) {
    const homeUrl = "https://daotao.qnu.edu.vn/Home";
    try {
        const response = await session.get(homeUrl);
        return response.status === 200; // Phiên còn hiệu lực nếu trả về mã 200
    } catch (error) {
        return false; // Phiên hết hạn nếu có lỗi
    }
}

// Hàm đăng nhập vào trang web của trường
async function loginToSchool(username, password) {
    const loginUrl = "https://daotao.qnu.edu.vn/Login";
    const payload = { txtTaiKhoan: username, txtMatKhau: password };
    const session = axios.create();

    try {
        const response = await session.post(loginUrl, payload);
        if (response.status === 302) {  // Đăng nhập thành công
            return session;
        }
    } catch (error) {
        console.error('Đăng nhập thất bại:', error);
    }
    return null; // Đăng nhập thất bại
}

// Hàm kiểm tra điểm mới
async function checkNewGrades() {
    for (const [chatId, credentials] of Object.entries(userCredentials)) {
        const { username, password, session } = credentials;

        // Kiểm tra hiệu lực phiên
        if (!(await isSessionValid(session))) {
            const newSession = await loginToSchool(username, password);
            if (!newSession) {
                // Gửi thông báo lỗi
                bot.sendMessage(chatId, "Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại bằng lệnh /login.");
                continue;
            }
            credentials.session = newSession; // Cập nhật phiên mới
        }

        // Tiếp tục kiểm tra điểm
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

        // Gửi thông báo nếu có điểm mới
        if (newGrades.length > 0) {
            bot.sendMessage(chatId, `Các môn học sau đã có điểm: ${newGrades.join(', ')}`);
        }
    }
}

// Lệnh /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "Chào mừng bạn đến với bot kiểm tra điểm! Sử dụng lệnh /login để đăng nhập.");
});

// Lệnh /login
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

// Lệnh /checkgrades
bot.onText(/\/checkgrades/, async (msg) => {
    const chatId = msg.chat.id;
    if (userCredentials[chatId]) {
        await checkNewGrades();
    } else {
        bot.sendMessage(chatId, "Bạn chưa đăng nhập. Vui lòng sử dụng lệnh /login để đăng nhập.");
    }
});

// Lệnh /logout
bot.onText(/\/logout/, (msg) => {
    const chatId = msg.chat.id;
    if (userCredentials[chatId]) {
        delete userCredentials[chatId];
        bot.sendMessage(chatId, "Đăng xuất thành công! Bạn đã được xóa khỏi hệ thống.");
    } else {
        bot.sendMessage(chatId, "Bạn chưa đăng nhập. Vui lòng sử dụng lệnh /login để đăng nhập.");
    }
});

// Lên lịch chạy hàm checkNewGrades() mỗi 15 phút
cron.schedule('*/15 * * * *', () => {
    console.log('Đang kiểm tra điểm mới...');
    checkNewGrades();
});

// Khởi động server
app.listen(port, () => {
    console.log(`Server đang chạy tại http://localhost:${port}`);
});