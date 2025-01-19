import os
from dotenv import load_dotenv
from fastapi import FastAPI, Request, BackgroundTasks
from telegram import Update, Bot
from telegram.ext import Application, CommandHandler, ConversationHandler, MessageHandler, filters
import requests
from bs4 import BeautifulSoup

# Tải biến môi trường từ tệp .env
load_dotenv()

# Lấy BOT_TOKEN từ biến môi trường
BOT_TOKEN = os.getenv("BOT_TOKEN")
bot = Bot(token=BOT_TOKEN)

# Các trạng thái cho ConversationHandler
WAITING_FOR_USERNAME, WAITING_FOR_PASSWORD = range(2)

# Tạo ứng dụng FastAPI
app = FastAPI()

# Lưu trữ thông tin người dùng
user_credentials = {}

# Tạo ứng dụng Telegram Bot
application = Application.builder().token(BOT_TOKEN).build()

# Hàm đăng nhập
async def login(update: Update, context) -> int:
    await update.message.reply_text("Vui lòng nhập mã sinh viên của bạn:")
    return WAITING_FOR_USERNAME

async def get_username(update: Update, context) -> int:
    context.user_data["username"] = update.message.text
    await update.message.reply_text("Vui lòng nhập mật khẩu của bạn:")
    return WAITING_FOR_PASSWORD

async def get_password(update: Update, context) -> int:
    username = context.user_data["username"]
    password = update.message.text

    # Kiểm tra thông tin đăng nhập
    session = login_to_school(username, password)
    if session:
        user_credentials[update.effective_chat.id] = {
            "username": username,
            "password": password,
            "session": session,
        }
        await update.message.reply_text("Đăng nhập thành công! Bot sẽ thông báo khi có điểm mới.")
    else:
        await update.message.reply_text("Đăng nhập thất bại. Vui lòng thử lại bằng lệnh /login.")
    return ConversationHandler.END

# Hàm đăng xuất
async def logout(update: Update, context) -> None:
    chat_id = update.effective_chat.id
    if chat_id in user_credentials:
        del user_credentials[chat_id]
        await update.message.reply_text("Đăng xuất thành công! Bạn đã được xóa khỏi hệ thống.")
    else:
        await update.message.reply_text("Bạn chưa đăng nhập. Vui lòng sử dụng lệnh /login để đăng nhập.")

# Hàm đăng nhập vào trang web của trường
def login_to_school(username, password):
    login_url = "https://daotao.qnu.edu.vn/Login"
    payload = {"txtTaiKhoan": username, "txtMatKhau": password}
    session = requests.Session()
    response = session.post(login_url, data=payload)

    if response.status_code == 302:  # Đăng nhập thành công
        return session
    else:
        return None  # Đăng nhập thất bại

# Kiểm tra điểm mới và gửi thông báo
def check_new_grades():
    for chat_id, credentials in user_credentials.items():
        session = credentials["session"]
        username = credentials["username"]
        password = credentials["password"]

        # Kiểm tra hiệu lực phiên
        if not is_session_valid(session):
            session = login_to_school(username, password)
            if not session:
                bot.send_message(chat_id=chat_id, text="Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại bằng lệnh /login.")
                continue
            credentials["session"] = session

        # Lấy điểm
        marks_url = "https://daotao.qnu.edu.vn/Home/Marks"
        response = session.get(marks_url)
        soup = BeautifulSoup(response.content, "html.parser")
        rows = soup.find_all("tr")

        new_grades = []
        for row in rows:
            cells = row.find_all("td")
            if len(cells) > 4 and "Khảo sát để xem điểm" in cells[4].text:
                new_grades.append(cells[2].text.strip())

        # Gửi thông báo nếu có điểm mới
        if new_grades:
            bot.send_message(chat_id=chat_id, text=f"Các môn học sau đã có điểm: {', '.join(new_grades)}")

# Kiểm tra hiệu lực phiên đăng nhập
def is_session_valid(session):
    home_url = "https://daotao.qnu.edu.vn/Home"
    response = session.get(home_url)
    return response.status_code == 200


# Webhook xử lý Telegram
@app.post("/")
async def telegram_webhook(request: Request, background_tasks: BackgroundTasks):
    data = await request.json()
    update = Update.de_json(data, bot)
    await application.process_update(update)

    # Thêm logic kiểm tra điểm trong nền
    background_tasks.add_task(check_new_grades)
    return {"ok": True}

# ConversationHandler cho login
conv_handler = ConversationHandler(
    entry_points=[CommandHandler("login", login)],
    states={
        WAITING_FOR_USERNAME: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_username)],
        WAITING_FOR_PASSWORD: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_password)],
    },
    fallbacks=[],
)

# Thêm handler vào bot
application.add_handler(conv_handler)
application.add_handler(CommandHandler("logout", logout))
