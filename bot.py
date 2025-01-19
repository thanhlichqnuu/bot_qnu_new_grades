import requests
from bs4 import BeautifulSoup
import schedule
import time
from telegram import Update, Bot
from telegram.ext import Updater, CommandHandler, MessageHandler, Filters, CallbackContext

# Thay thế bằng bot token của bạn
BOT_TOKEN = '8184585638:AAH9b9A3ZtE6qW97NxVrzw3o6DwawuVMOSk'

# Lưu trữ thông tin đăng nhập của người dùng (tạm thời, nên dùng database trong thực tế)
user_credentials = {}

# Hàm xử lý lệnh /login
def login(update: Update, context: CallbackContext):
    update.message.reply_text("Vui lòng nhập mã sinh viên của bạn:")
    return "WAITING_FOR_USERNAME"

# Hàm xử lý khi nhận được mã sinh viên
def get_username(update: Update, context: CallbackContext):
    username = update.message.text
    context.user_data['username'] = username
    update.message.reply_text("Vui lòng nhập mật khẩu của bạn:")
    return "WAITING_FOR_PASSWORD"

# Hàm xử lý khi nhận được mật khẩu
def get_password(update: Update, context: CallbackContext):
    password = update.message.text
    username = context.user_data['username']

    # Kiểm tra thông tin đăng nhập
    session = login_to_school(username, password)
    if session:
        user_credentials[update.message.chat_id] = {
            'username': username,
            'password': password,
            'session': session
        }
        update.message.reply_text("Đăng nhập thành công! Bot sẽ thông báo khi có điểm mới.")
    else:
        update.message.reply_text("Đăng nhập thất bại. Vui lòng thử lại với lệnh /login.")

    return -1  # Kết thúc conversation

# Hàm xử lý lệnh /logout
def logout(update: Update, context: CallbackContext):
    chat_id = update.message.chat_id
    if chat_id in user_credentials:
        del user_credentials[chat_id]
        update.message.reply_text("Đăng xuất thành công! Bạn đã được xóa khỏi hệ thống.")
    else:
        update.message.reply_text("Bạn chưa đăng nhập. Vui lòng sử dụng lệnh /login để đăng nhập.")

# Hàm đăng nhập vào trang web của trường
def login_to_school(username, password):
    login_url = 'https://daotao.qnu.edu.vn/Login'
    payload = {
        'txtTaiKhoan': username,
        'txtMatKhau': password
    }
    session = requests.Session()
    response = session.post(login_url, data=payload)

    # Kiểm tra mã trạng thái phản hồi
    if response.status_code == 302:  # Đăng nhập thành công
        return session
    else:
        return None  # Đăng nhập thất bại

# Hàm kiểm tra phiên đăng nhập
def is_session_valid(session):
    home_url = 'https://daotao.qnu.edu.vn/Home'
    response = session.get(home_url)
    return response.status_code == 200  # Phiên còn hiệu lực nếu mã trạng thái là 200

# Hàm kiểm tra điểm mới
def check_new_grades():
    for chat_id, credentials in user_credentials.items():
        username = credentials['username']
        password = credentials['password']
        session = credentials.get('session')

        # Kiểm tra phiên đăng nhập
        if not session or not is_session_valid(session):
            # Tự động đăng nhập lại nếu phiên hết hạn
            session = login_to_school(username, password)
            if session:
                credentials['session'] = session
            else:
                bot = Bot(token=BOT_TOKEN)
                bot.send_message(chat_id=chat_id, text="Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại bằng lệnh /login.")
                continue

        # Lấy điểm
        marks_url = 'https://daotao.qnu.edu.vn/Home/Marks'
        response = session.get(marks_url)
        soup = BeautifulSoup(response.content, 'html.parser')
        rows = soup.find_all('tr')

        new_grades = []
        for row in rows:
            cells = row.find_all('td')
            if len(cells) > 4 and "Khảo sát để xem điểm" in cells[4].text:
                subject_name = cells[2].text.strip()
                new_grades.append(subject_name)

        # Gửi thông báo nếu có điểm mới
        if new_grades:
            bot = Bot(token=BOT_TOKEN)
            bot.send_message(chat_id=chat_id, text=f"Các môn học sau đã có điểm: {', '.join(new_grades)}")

# Lập lịch kiểm tra điểm mới mỗi 5 phút
schedule.every(5).minutes.do(check_new_grades)

# Hàm chính để chạy bot
def main():
    updater = Updater(BOT_TOKEN, use_context=True)
    dp = updater.dispatcher

    # Thêm các handler cho lệnh /login, /logout và xử lý tin nhắn
    dp.add_handler(CommandHandler("login", login))
    dp.add_handler(CommandHandler("logout", logout))
    dp.add_handler(MessageHandler(Filters.text & ~Filters.command, get_username))
    dp.add_handler(MessageHandler(Filters.text & ~Filters.command, get_password))

    updater.start_polling()
    updater.idle()

    # Chạy lập lịch kiểm tra điểm
    while True:
        schedule.run_pending()
        time.sleep(1)

if __name__ == '__main__':
    main()