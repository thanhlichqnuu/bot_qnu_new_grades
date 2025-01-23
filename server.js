require("dotenv").config();
const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const puppeteer = require("puppeteer");
const bcrypt = require("bcrypt");
const User = require("./models/User");
const connectDB = require("./connectDB");

const app = express();
const port = process.env.PORT;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);

const sessions = {};
const checkGradeIntervals = {};
const gradeNotifications = {};
const pendingLogin = {};

bot.setWebHook(`${WEBHOOK_URL}`);
connectDB();

app.use(express.json());
app.post(`/${TELEGRAM_BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.get("/", (req, res) => res.send("Bot is running!"));


const loginToSchool = async (username, password, chatId) => {
  const browser = await puppeteer.launch({
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();

  try {
    await page.goto("https://daotao.qnu.edu.vn/Login", {
      waitUntil: "networkidle2",
    });
    await page.type('input[name="txtTaiKhoan"]', username);
    await page.type('input[name="txtMatKhau"]', password);
    await page.click('input[type="submit"]');
    await page.waitForNavigation({ waitUntil: "networkidle2" });

    if (page.url().includes("Home")) {
      sessions[chatId] = { browser };
      return true;
    } else {
      await browser.close();
      return false;
    }
  } catch {
    await browser.close();
    return false;
  }
};

const checkNewGrades = async (chatId) => {
  const page = await sessions[chatId].browser.newPage();

  try {
    await page.goto("https://daotao.qnu.edu.vn/Home/Marks", {
      waitUntil: "networkidle2",
    });

    const newGrades = await page.evaluate(() => {
      const grades = [];
      document.querySelectorAll("tr").forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length > 4) {
          const surveyLink = cells[4].querySelector("a");
          if (surveyLink?.textContent?.includes("Khảo sát để xem điểm")) {
            grades.push(cells[2].textContent.trim());
          }
        }
      });
      return grades;
    });

    if (newGrades.length > 0) {
      const message = `Các môn học sau đã có điểm: ${newGrades.join(", ")}`;

      if (!gradeNotifications[chatId]) {
        gradeNotifications[chatId] = {};
      }

      if (!gradeNotifications[chatId][message]) {
        gradeNotifications[chatId][message] = 0;
      }

      if (gradeNotifications[chatId][message] < 3) {
        bot.sendMessage(chatId, message);
        gradeNotifications[chatId][message] += 1;
      }

      for (const msg in gradeNotifications[chatId]) {
        if (msg !== message) {
          delete gradeNotifications[chatId][msg];
        }
      }
    }
  } catch (err) {
    console.error(err);
    bot.sendMessage(
      chatId,
      "Đã xảy ra lỗi khi kiểm tra điểm! Vui lòng thử lại."
    );
  } finally {
    await page.close();
  }
};

const handleLogin = async (chatId, username, password) => {
  const loginResult = await loginToSchool(username, password, chatId);

  if (loginResult) {
    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      const user = new User({ chatId, username, password: hashedPassword });
      await user.save();
      bot.sendMessage(
        chatId,
        `Đăng nhập thành công với mã sinh viên ${username}!`
      );
    } catch (err) {
      console.error("Lỗi khi lưu thông tin người dùng:", err);
      bot.sendMessage(chatId, "Đã xảy ra lỗi khi đăng nhập. Vui lòng thử lại!");
    }
  } else {
    bot.sendMessage(
      chatId,
      "Mã sinh viên hoặc mật khẩu không đúng! Vui lòng thử lại bằng lệnh /login."
    );
  }
  delete pendingLogin[chatId];
};

const toggleGradeCheck = async (chatId) => {
  const user = await User.findOne({ chatId });
  if (!user) {
    return bot.sendMessage(
      chatId,
      "Bạn chưa đăng nhập! Vui lòng sử dụng lệnh /login để đăng nhập trước."
    );
  }

  if (!sessions[chatId]?.browser) {
    return bot.sendMessage(
      chatId,
      "Browser đã bị đóng hoặc không hoạt động! Vui lòng thử đăng nhập lại để khởi tạo lại browser."
    );
  }

  if (checkGradeIntervals[chatId]) {
    clearInterval(checkGradeIntervals[chatId]);
    delete checkGradeIntervals[chatId];
    bot.sendMessage(chatId, "Đã dừng tiến trình kiểm tra điểm tự động!");
  } else {
    checkGradeIntervals[chatId] = setInterval(
      () => checkNewGrades(chatId),
      600000
    );
    delete gradeNotifications[chatId];
    bot.sendMessage(
      chatId,
      "Bật tiến trình kiểm tra điểm tự động 10 phút/1 lần thành công!"
    );
  }
};

const handleLogout = async (chatId) => {
  const user = await User.findOne({ chatId });
  if (!user) return bot.sendMessage(chatId, "Bạn chưa đăng nhập!");

  if (sessions[chatId]) {
    try {
      const { browser } = sessions[chatId];
      const page = await browser.newPage();
      await page.goto("https://daotao.qnu.edu.vn/Login/Logout", {
        waitUntil: "networkidle2",
      });
      await browser.close();
      delete sessions[chatId];
    } catch (err) {
      console.error(err);
      return bot.sendMessage(
        chatId,
        "Đã xảy ra lỗi khi đăng xuất. Vui lòng thử lại!"
      );
    }
  }

  if (checkGradeIntervals[chatId]) {
    clearInterval(checkGradeIntervals[chatId]);
    delete checkGradeIntervals[chatId];
  }

  delete gradeNotifications[chatId];
  await User.deleteOne({ chatId });
  bot.sendMessage(chatId, "Đăng xuất thành công!");
};

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `Chào mừng bạn đến với bot tiện ích dành riêng cho sinh viên QNU! 🎉

Sử dụng lệnh /login để đăng nhập.
Sử dụng lệnh /help để xem các lệnh hiện có.`
  );
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `
Các lệnh hiện có:
/login - Đăng nhập vào hệ thống.
/logout - Đăng xuất khỏi hệ thống.
/checkaccount - Kiểm tra thông tin đăng nhập hiện tại.
/checknewgrade - Bật/tắt tiến trình kiểm tra điểm tự động khi có môn học mới biết điểm (10 phút/1 lần).
/help - Xem các lệnh hiện có.
  `
  );
});

bot.onText(/\/login/, async (msg) => {
  const chatId = msg.chat.id;

  if (await User.findOne({ chatId })) {
    return bot.sendMessage(
      chatId,
      "Bạn đã đăng nhập trước đó! Sử dụng lệnh /logout để đăng xuất."
    );
  }

  bot.sendMessage(chatId, "Vui lòng nhập mã sinh viên:");
  pendingLogin[chatId] = true;

  bot.once("message", (usernameMsg) => {
    const username = usernameMsg.text;

    if (username.startsWith("/")) {
      delete pendingLogin[chatId];
      return bot.sendMessage(chatId, "Hủy bỏ đăng nhập do bạn nhập lệnh khác.");
    }

    bot.sendMessage(chatId, "Vui lòng nhập mật khẩu:");

    bot.once("message", (passwordMsg) => {
      const password = passwordMsg.text;

      if (password.startsWith("/")) {
        delete pendingLogin[chatId];
        return bot.sendMessage(
          chatId,
          "Hủy bỏ đăng nhập do bạn nhập lệnh khác."
        );
      }

      handleLogin(chatId, username, password);
    });
  });
});

bot.onText(/\/checknewgrade/, (msg) => toggleGradeCheck(msg.chat.id));

bot.onText(/\/checkaccount/, async (msg) => {
  const user = await User.findOne({ chatId: msg.chat.id });
  bot.sendMessage(
    msg.chat.id,
    user
      ? `Mã sinh viên đang đăng nhập hiện tại: ${user.username}`
      : "Bạn chưa đăng nhập!"
  );
});

bot.onText(/\/logout/, (msg) => handleLogout(msg.chat.id));

bot.on("message", (msg) => {
  if (
    msg.text.startsWith("/") &&
    ![
      "/start",
      "/help",
      "/login",
      "/logout",
      "/checkaccount",
      "/checknewgrade",
    ].includes(msg.text)
  ) {
    bot.sendMessage(
      msg.chat.id,
      `Lệnh \"${msg.text}\" không tồn tại. Sử dụng /help để xem các lệnh hiện có.`
    );
  }
});

app.listen(port, () =>
  console.log(`Server is running at http://localhost:${port}`)
);
